// --- Global State ---
let runs = JSON.parse(localStorage.getItem('strava_runs_v3')) || [];
let profile = JSON.parse(localStorage.getItem('strava_profile_v3')) || { 
    name: "New Runner", 
    photo: null,
    gear: [{id: 1, name: "Default Shoes", dist: 0}]
};

// Runtime variables
let timerInterval, totalSeconds = 0, isRunning = false;
let watchId = null, mapInstance = null, polyline = null;
let pathCoordinates = []; // Format: [lat, lng, alt, time]
let totalDistance = 0; // km
let elevationGain = 0; // meters
let lastAltitude = null;
let historyMapInstance = null;
let isManualEntry = false;
let currentRunIdForExport = null;

// --- Initialization ---
window.onload = function() {
    renderFeed();
    updateStats();
    loadProfileUI();
};

// --- Navigation ---
function switchTab(tab) {
    // Hide all views
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('tracker-view').style.display = 'none';
    document.getElementById('profile-view').style.display = 'none';
    
    // Reset Nav Active States
    document.getElementById('nav-home').classList.remove('active');
    document.getElementById('nav-record').classList.remove('active');
    document.getElementById('nav-profile').classList.remove('active');

    // Show Selected View
    if (tab === 'home') {
        document.getElementById('home-view').style.display = 'block';
        document.getElementById('nav-home').classList.add('active');
        document.getElementById('manual-add-btn').style.display = 'block';
    } else if (tab === 'record') {
        document.getElementById('tracker-view').style.display = 'flex';
        document.getElementById('nav-record').classList.add('active');
        document.getElementById('manual-add-btn').style.display = 'none';
        setTimeout(initLiveMap, 100);
    } else if (tab === 'profile') {
        document.getElementById('profile-view').style.display = 'block';
        document.getElementById('nav-profile').classList.add('active');
        document.getElementById('manual-add-btn').style.display = 'none';
        loadProfileUI();
    }
}

// --- GPS & Tracking ---
function initLiveMap() {
    if (mapInstance) return;
    mapInstance = L.map('live-map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);
    polyline = L.polyline([], {color: '#fc4c02', weight: 5}).addTo(mapInstance);
}

function startRun() {
    if (!navigator.geolocation) return alert("GPS not supported on this device.");
    
    isRunning = true;
    toggleButtons('running');
    document.getElementById('gps-status').innerText = "Locating Satellites...";
    
    timerInterval = setInterval(() => { totalSeconds++; updateDashboard(); }, 1000);

    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const alt = pos.coords.altitude || 0;
            const accuracy = pos.coords.accuracy;

            document.getElementById('gps-status').innerText = `Recording (±${Math.round(accuracy)}m)`;
            
            if (pathCoordinates.length > 0) {
                const last = pathCoordinates[pathCoordinates.length-1];
                const dist = calcDist(last[0], last[1], lat, lng);
                
                // Filter small movements (noise) < 5 meters
                if (dist > 0.005) { 
                    totalDistance += dist; 
                    
                    // Elevation Logic (Only add positive gain)
                    if (lastAltitude !== null && alt > lastAltitude) {
                        elevationGain += (alt - lastAltitude);
                    }
                    lastAltitude = alt;

                    // Push [Lat, Lng, Alt, Time]
                    pathCoordinates.push([lat, lng, alt, new Date().toISOString()]); 
                    updateMapLine(); 
                }
            } else {
                // First point
                pathCoordinates.push([lat, lng, alt, new Date().toISOString()]);
                lastAltitude = alt;
                mapInstance.setView([lat, lng], 16);
                L.circleMarker([lat, lng], {radius: 6, color: 'green', fillOpacity: 1}).addTo(mapInstance);
            }
        }, 
        (err) => {
            console.error(err);
            document.getElementById('gps-status').innerText = "GPS Signal Lost";
        }, 
        options
    );
}

function updateMapLine() { 
    if(polyline) { 
        // Leaflet only needs [lat, lng], map our 4-point array to 2-point
        const simplePath = pathCoordinates.map(p => [p[0], p[1]]);
        polyline.setLatLngs(simplePath); 
        mapInstance.setView(simplePath[simplePath.length-1]); 
    }
}

function pauseRun() { 
    isRunning = false; 
    clearInterval(timerInterval); 
    navigator.geolocation.clearWatch(watchId); 
    toggleButtons('paused'); 
    document.getElementById('gps-status').innerText = "Paused";
}

function resumeRun() { startRun(); }

function updateDashboard() {
    document.getElementById('timer').innerText = formatTime(totalSeconds);
    document.getElementById('live-dist').innerText = totalDistance.toFixed(2);
    document.getElementById('live-elev').innerText = Math.round(elevationGain); // Show elevation
    if(totalDistance > 0.05) {
        document.getElementById('live-pace').innerText = formatTime(totalSeconds/totalDistance, true);
    }
}

function toggleButtons(state) {
    document.getElementById('start-btn').style.display = 'none';
    document.getElementById('stop-btn').style.display = 'none';
    document.getElementById('finish-btn').style.display = 'none';
    document.getElementById('resume-btn').style.display = 'none';

    if (state === 'idle') document.getElementById('start-btn').style.display = 'block';
    if (state === 'running') document.getElementById('stop-btn').style.display = 'block';
    if (state === 'paused') {
        document.getElementById('finish-btn').style.display = 'block';
        document.getElementById('resume-btn').style.display = 'block';
    }
}

// --- Data Saving ---
function openManualEntry() {
    isManualEntry = true;
    document.getElementById('manual-fields').style.display = 'block';
    document.getElementById('save-dist-display').style.display = 'none';
    populateShoeSelect();
    document.getElementById('save-modal').style.display = 'flex';
}

function openFinishModal() {
    isManualEntry = false;
    document.getElementById('manual-fields').style.display = 'none';
    document.getElementById('save-dist-display').style.display = 'block';
    document.getElementById('save-dist-display').innerText = totalDistance.toFixed(2) + " km";
    document.getElementById('save-title').value = getTimeGreeting() + " Run";
    populateShoeSelect();
    document.getElementById('save-modal').style.display = 'flex';
}

function closeSaveModal() { document.getElementById('save-modal').style.display = 'none'; }

function populateShoeSelect() {
    const select = document.getElementById('save-shoe');
    select.innerHTML = '';
    profile.gear.forEach(shoe => {
        const opt = document.createElement('option');
        opt.value = shoe.id;
        opt.text = shoe.name;
        select.appendChild(opt);
    });
}

function confirmSave() {
    const title = document.getElementById('save-title').value;
    const desc = document.getElementById('save-desc').value;
    const shoeId = parseInt(document.getElementById('save-shoe').value);
    
    let dist, secs;

    if (isManualEntry) {
        dist = parseFloat(document.getElementById('manual-dist-input').value) || 0;
        secs = parseFloat(document.getElementById('manual-time-input').value) * 60 || 0;
    } else {
        dist = totalDistance;
        secs = totalSeconds;
    }

    if (dist <= 0) return alert("Distance must be greater than 0");

    const run = {
        id: Date.now(),
        title: title || "Run",
        desc: desc,
        date: new Date().toISOString(),
        distance: dist,
        seconds: secs,
        elevation: elevationGain,
        shoeId: shoeId,
        path: isManualEntry ? [] : pathCoordinates
    };

    // Update Shoe Mileage
    const shoe = profile.gear.find(g => g.id === shoeId);
    if(shoe) shoe.dist += dist;
    saveProfile();

    // Save Run
    runs.unshift(run);
    localStorage.setItem('strava_runs_v3', JSON.stringify(runs));

    closeSaveModal();
    resetTracker();
    switchTab('home');
    renderFeed();
    updateStats();
}

function resetTracker() {
    totalSeconds = 0; totalDistance = 0; elevationGain = 0; lastAltitude = null;
    pathCoordinates = []; isRunning = false;
    
    clearInterval(timerInterval); navigator.geolocation.clearWatch(watchId);
    if(mapInstance) { mapInstance.remove(); mapInstance = null; }
    
    toggleButtons('idle');
    updateDashboard();
    
    document.getElementById('timer').innerText = "00:00:00";
    document.getElementById('live-dist').innerText = "0.00";
    document.getElementById('live-pace').innerText = "--:--";
    document.getElementById('live-elev').innerText = "0";
}

// --- Profile & UI ---
function loadProfileUI() {
    document.getElementById('profile-name').innerText = profile.name;
    if(profile.photo) {
        document.getElementById('profile-img').src = profile.photo;
        document.getElementById('profile-img').style.display = 'block';
        document.getElementById('profile-initial').style.display = 'none';
    }

    // Stats
    let totalKm = 0;
    runs.forEach(r => totalKm += r.distance);
    document.getElementById('all-time-km').innerText = totalKm.toFixed(1);
    document.getElementById('all-time-runs').innerText = runs.length;

    // Gear List
    const container = document.getElementById('gear-container');
    container.innerHTML = '';
    profile.gear.forEach(shoe => {
        container.innerHTML += `
        <div class="gear-item">
            <div class="gear-icon">👟</div>
            <div style="flex:1;">
                <div style="font-weight:bold;">${shoe.name}</div>
                <div style="color:var(--text-gray); font-size:0.9rem;">${shoe.dist.toFixed(1)} km</div>
            </div>
        </div>`;
    });
}

function handleAvatarUpload(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            profile.photo = e.target.result; // Save base64 string
            saveProfile();
            loadProfileUI();
        }
        reader.readAsDataURL(input.files[0]);
    }
}

function addShoe() {
    const name = prompt("Shoe Name (e.g. Nike Pegasus):");
    if(name) {
        profile.gear.push({ id: Date.now(), name: name, dist: 0 });
        saveProfile();
        loadProfileUI();
    }
}

function saveProfile() { localStorage.setItem('strava_profile_v3', JSON.stringify(profile)); }

function renderFeed() {
    const container = document.getElementById('feed-container');
    container.innerHTML = '';
    if (runs.length === 0) return container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">No runs yet.</p>';

    runs.forEach(run => {
        const date = new Date(run.date).toLocaleDateString('en-US', {month:'short', day:'numeric'});
        const shoeName = profile.gear.find(g => g.id === run.shoeId)?.name || "";
        const hasMap = run.path && run.path.length > 0;
        const elev = run.elevation ? Math.round(run.elevation) : 0;
        
        let html = `
        <div class="activity">
            <div class="user-header">
                <div class="avatar-small">
                     ${profile.photo ? `<img src="${profile.photo}">` : profile.name.charAt(0)}
                </div>
                <div>
                    <h3 style="font-size:0.95rem;">${profile.name}</h3>
                    <span style="font-size:0.75rem; color:gray;">${date}</span>
                </div>
            </div>
            <h2 style="font-size:1.1rem;">${run.title}</h2>
            ${run.desc ? `<p style="font-size:0.9rem; color:#444; margin-bottom:5px;">${run.desc}</p>` : ''}
            <div class="run-stats">
                <div class="run-stat"><label>Distance</label>${run.distance.toFixed(2)} km</div>
                <div class="run-stat"><label>Pace</label>${formatTime(run.seconds/run.distance, true)} /km</div>
                <div class="run-stat"><label>Time</label>${formatTime(run.seconds)}</div>
            </div>
            ${elev > 0 ? `<div style="font-size:0.8rem; color:gray; margin-top:5px;">Elevation: ${elev}m</div>` : ''}
            
            ${shoeName ? `<span class="shoe-tag">👟 ${shoeName}</span>` : ''}
            ${hasMap ? `<button class="btn-map" onclick="viewMap(${run.id})">🗺️ View Map</button>` : ''}
        </div>`;
        container.innerHTML += html;
    });
}

function viewMap(id) {
    currentRunIdForExport = id;
    const run = runs.find(r => r.id === id);
    document.getElementById('map-modal').style.display = 'flex';
    setTimeout(() => {
        if(historyMapInstance) historyMapInstance.remove();
        historyMapInstance = L.map('history-map');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(historyMapInstance);
        
        // Map 4-point data [lat, lng, alt, time] back to 2-point [lat, lng] for Leaflet display
        const simplePath = run.path.map(p => [p[0], p[1]]);
        
        const line = L.polyline(simplePath, {color:'#fc4c02', weight:5}).addTo(historyMapInstance);
        historyMapInstance.fitBounds(line.getBounds());
    }, 100);
}

// --- EXPORT GPX ---
function exportGPX() {
    if(!currentRunIdForExport) return;
    const run = runs.find(r => r.id === currentRunIdForExport);
    if(!run || !run.path || run.path.length === 0) return alert("No GPS data for this run.");

    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RunStrava" xmlns="http://www.topografix.com/GPX/1/1">
 <trk>
  <name>${run.title}</name>
  <trkseg>`;

    run.path.forEach(pt => {
        const lat = pt[0];
        const lng = pt[1];
        const ele = pt[2] || 0;
        const time = pt[3] || new Date().toISOString();

        gpx += `
   <trkpt lat="${lat}" lon="${lng}">
    <ele>${ele}</ele>
    <time>${time}</time>
   </trkpt>`;
    });

    gpx += `
  </trkseg>
 </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `runstrava_${run.id}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// --- Helpers ---
function updateStats() {
    let d=0, t=0;
    runs.forEach(r => { d += r.distance; t += r.seconds; });
    document.getElementById('weekly-km').innerText = d.toFixed(1);
    document.getElementById('weekly-runs').innerText = runs.length;
    document.getElementById('weekly-time').innerText = Math.floor(t/3600) + "h " + Math.floor((t%3600)/60) + "m";
}

function calcDist(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function formatTime(s, pace=false) {
    if(!s || s===Infinity) return "00:00";
    s = Math.round(s);
    const m = Math.floor((s%3600)/60).toString().padStart(2,'0');
    const sec = (s%60).toString().padStart(2,'0');
    if(pace) return `${Math.floor(s/60)}:${sec}`;
    return (Math.floor(s/3600)>0 ? Math.floor(s/3600)+":" : "") + `${m}:${sec}`;
}

function getTimeGreeting() { const h = new Date().getHours(); return h<12?"Morning":h<18?"Afternoon":"Evening"; }
function resetData() { if(confirm("Clear all data?")) { localStorage.clear(); location.reload(); } }