    // ====== Config ====== //
    mapboxgl.accessToken = "pk.eyJ1Ijoid2l6YXJkdHJlZXMiLCJhIjoiY21qeDdkN2hnNmNsYTNkcHM4Z2R3ODN2biJ9.ghmh02ohGWaz_3Jyw7-e0A";
    const GEOJSON_URL = "https://raw.githubusercontent.com/JonathanChiquet/wt-locations/refs/heads/main/retailers.geojson";
    const SEARCH_RADIUS_MI = 50;

    // ====== DOM (Webflow) ====== //
    const formEl = document.getElementById("storeSearchForm");
    const inputEl = document.getElementById("storeSearchInput");
    const resultsEl = document.getElementById("resultWrapper");
    const showAllBtn = document.getElementById("showAllBtn");

    // ====== Map init ====== //
    const map = new mapboxgl.Map({
        container: "retail-map",
        style: "mapbox://styles/wizardtrees/cmjxix4uf00bq01qs208d9xfr",
        center: [-119.5, 37.2],
        zoom: 5.4,
        interactive: true,
        attributionControl: false,
        cooperativeGestures: true
    });

    // ====== Disable scroll outside the map ====== //
    const mapEl = document.getElementById("retail-map");
    let overMap = false;
        
    mapEl.addEventListener("mouseenter", () => overMap = true);
    mapEl.addEventListener("mouseleave", () => overMap = false);
    
    window.addEventListener("wheel", (e) => {
        if (!overMap) return;
        e.preventDefault();
    }, { passive: false, capture: true });
    
    window.addEventListener("touchmove", (e) => {
        if (!overMap) return;
        e.preventDefault();
    }, { passive: false, capture: true });

    // ====== State ====== //
    let allRetailers = null;
    let activePopup = null;

    // ====== Helpers ====== //
    function clearResults() {
        if (!resultsEl) return;
        resultsEl.innerHTML = ""
    }

    function renderEmptyState(msg) {
        if (!resultsEl) return;
        resultsEl.innerHTML = `<div class="no-results">${ msg }</div>`
    }

    function renderResults(features) {
        if (!resultsEl) return;

        if (!features.length) {
            renderEmptyState("No results found.");
            return;
        }

        const itemsHtml = features.map((f, idx) => {
            const p = f.properties || {};
            const retailer = p.retailer || "Retailer";
            const address = p.address1 || "";
            const directionUrl = p.directionUrl || "#";
            const dist = typeof f.__distanceMi === "number" ? f.__distanceMi : null;

            return `
                <div class="retailer-item" data-idx="${idx}">
                    <div class="retailer-item__title">${escapeHtml(retailer)}</div>
                    <div class="retailer-item__address">${escapeHtml(address)}</div>
                    ${
                    dist !== null
                        ? `<div class="retailer-item__meta">${dist.toFixed(1)} mi</div>`
                        : ""
                    }
                    ${
                    directionUrl && directionUrl !== "#"
                        ? `<a class="retailer-item__link" href="${directionUrl}" target="_blank" rel="noopener">Directions</a>`
                        : ""
                    }
                </div>
            `;
        }).join("");

        resultsEl.innerHTML = itemsHtml;

        // ====== Click Handler: flyTo + popup ====== //
        const nodes = resultsEl.querySelectorAll(".retailer-item");
        nodes.forEach((node) => {
            node.addEventListener("click", () => {
                const idx = Number(node.getAttribute("data-idx"));
                const f = features[idx];
                if (!f) return;

                const coords = f.geometry.coordinates.slice();
                flyToAndOpenPopup(f, coords);
            });
        });
    }

    function flyToAndOpenPopup(feature, coordinates) {
        const { retailer, address1, directionUrl } = feature.properties || {};
        map.flyTo({
            center: coordinates,
            zoom: Math.max(map.getZoom(), 11),
            essential: true
        });

        if (activePopup) activePopup.remove();

        const popupContent = `
            <div class="retail-popup">
                <strong>${escapeHtml(retailer || "Retailer")}</strong><br/>
                <span>${escapeHtml(address1 || "")}</span><br/><br/>
                ${
                directionUrl
                    ? `<a href="${directionUrl}" target="_blank" rel="noopener" class="popup-link">Directions</a>`
                    : ""
                }
            </div>
        `;

        activePopup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            offset: 25
        })
            .setLngLat(coordinates)
            .setHTML(popupContent)
            .addTo(map);
    }

    // ====== IMPORTANT: escapeHtml to avoid XSS (Cross Site Scripting) ====== //
    function escapeHtml(str) {
        return String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    // ====== Calculation between the user's location and retailer's location ====== //
    function haversineMiles(aLng, aLat, bLng, bLat) {
        const R = 3958.7613; // miles
        const toRad = (d) => (d * Math.PI) / 180;

        const dlat = toRad(bLat - aLat);
        const dLng = toRad(bLng - aLng);

        const lat1 = toRad(aLat);
        const lat2 = toRad(bLat);

        const sin1 = Math.sin(dlat / 2);
        const sin2 = Math.sin(dLng / 2);

        const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2;

        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function fitToFeatures(features) {
        const bounds = new mapboxgl.LngLatBounds();
        features.forEach((f) => bounds.extend(f.geometry.coordinates));
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 10 });
    }

    async function geocode(query) {
        const q = encodeURIComponent(query.trim());
        const bbox = CA_BBOX.join(",");

        const url =
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json` +
            `?access_token=${encodeURIComponent(mapboxgl.accessToken)}` +
            `&autocomplete=true&country=us&limit=1` +
            `&types=postcode,place,locality,neighborhood,address` +
            `&bbox=${bbox}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Geocoding failed");
        const data = await res.json();

        const first = data.features && data.features[0];
        if (!first) return null;

        return {
            lng: first.center[0],
            lat: first.center[1],
            label: first.place_name
        };
    }

    function filterRetailersByRadius(originLng, originLat, radiusMi) {
        const feats = allRetailers?.features || [];
        const within = [];

        for (const f of feats) {
            const [lng, lat] = f.geometry.coordinates;
            const d = haversineMiles(originLng, originLat, lng, lat);
            if (d <= radiusMi) {
                const copy = {
                    ...f, properties: { ...(f.properties || {}) }
                };
                copy.__distanceMi = d;
                within.push(copy);
            }
        }
        within.sort((a, b) => a.__distanceMi - b.__distanceMi);
        return within;
    }

    function updatePins(features) {
        const src = map.getSource("retailers");
        if (!src) return;

        src.setData({
            type: "FeatureCollection",
            features: features
        });
    }

    function resetAll() {
        if (!allRetailers) return;

        clearResults();
        updatePins(allRetailers.features);
        fitToFeatures(allRetailers.features);

        if (activePopup) activePopup.remove();
        if (inputEl) inputEl.value = "";

        renderResults(allRetailers.features);
    }
  
    // ====== Pin locators configuration (map load) ====== //
    map.on("load", async () => {
        const response = await fetch(GEOJSON_URL);
        allRetailers = await response.json();
        map.addSource("retailers", { type: "geojson", data: allRetailers });
                
        // ====== Pin style configuration ====== //
        map.loadImage("https://cdn.prod.website-files.com/68a4d657a90b36bf514a7ba2/695c18123c73ab0436ec5504_f8d09f9331a9d2905225f749d0160792_pin.png", (err, image) => {
                if (err) throw err;
                if (!map.hasImage("retail-pin")) map.addImage("retail-pin", image);

                map.addLayer({
                    id: "retailers-pins",
                    type: "symbol",
                    source: "retailers",
                    layout: {
                        "icon-image": "retail-pin",
                        "icon-size": 0.45,
                        "icon-anchor": "bottom",
                        "icon-allow-overlap": true
                    }
                });
            })

        // ====== Popup locator config ====== //
        map.on("click", "retailers-pins", (e) => {
            const feature = e.features[0]
            const coords = feature.geometry.coordinates.slice();
            flyToAndOpenPopup(feature, coords);
        });

        map.on("mouseenter", "retailers-pins", () => {
            map.getCanvas().style.cursor = "pointer"
        });

        map.on("mouseleave", "retailers-pins", () => {
            map.getCanvas().style.cursor = "";
        });

        fitToFeatures(allRetailers.features);
        /*const bounds = new mapboxgl.LngLatBounds();
        allRetailers.features.forEach(f => bounds.extend(f.geometry.coordinates));
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 10 });*/
    });

    // ====== Form Search ====== //
    if (formEl) {
        formEl.addEventListener("submit", async (e) => {
            e.preventDefault();

            const q = (inputEl?.value || "").trim();
            if (!q) {
                renderEmptyState("Type a city or zip code...");
                return;
            }

            clearResults();
            renderEmptyState("Searching...");

            try { 
                const geo = await geocode(q);
                if (!geo) {
                    renderEmptyState("No results found.");
                    return;
                }
                const filtered = filterRetailersByRadius(geo.lng, geo.lat, SEARCH_RADIUS_MI);
                updatePins(filtered);
                if (filtered.length) {
                    fitToFeatures(filtered); 
                } else {
                    map.flyTo({ center: [geo.lng, geo.lat], zoom: 10, essential: true })
                }

                renderResults(filtered, [geo.lng, geo.lat]);
                
            } catch(err) {
                console.error(err);
                renderEmptyState("Something went wrong. Try again.")
            }
        });
    }

    // ====== Show All Locations Button ====== //
    if (showAllBtn) {
        showAllBtn.addEventListener("click", (e) => {
            e.preventDefault();
            resetAll();
        });
    }