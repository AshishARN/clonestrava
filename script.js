// --- Global State ---
let runs = JSON.parse(localStorage.getItem('strava_runs_v3')) || [];
let profile = JSON.parse(localStorage.getItem('strava_profile_v3')) || { 
    name: "New Runner", 
    location: "World Citizen",
    photo: null,
    gear: [{id: 1, name: "Default Shoes", dist: 0}]
};

// Runtime variables
let timerInterval, totalSeconds = 0, isRunning = false;
let watchId = null, mapInstance = null, polyline = null;
let pathCoordinates = []; // [lat, lng, alt, time]
let totalDistance = 0, elevationGain = 0, lastAltitude = null;
let detailMapInstance = null; 
let isManualEntry = false;
let editingRunId = null;
let currentDetailRunId = null;

const bestEffortDistances = [
    { label: "400m", dist: 400 },
    { label: "1k", dist: 1000 },
    { label: "1 Mile", dist: 1609.34 },
    { label: "5k", dist: 5000 },
    { label: "10k", dist: 10000 },
    { label: "Half Marathon", dist: 21097.5 },
    { label: "Marathon", dist: 42195 }
];

window.onload = function() {
    renderFeed();
    updateStats();
    loadProfileUI();
};

// --- Navigation ---
function switchTab(tab) {
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('tracker-view').style.display = 'none';
    document.getElementById('profile-view').style.display = 'none';
    
    document.getElementById('nav-home').classList.remove('active');
    document.getElementById('nav-record').classList.remove('active');
    document.getElementById('nav-profile').classList.remove('active');

    if (tab === 'home') {
        document.getElementById('home-view').style.display = 'block';
        document.getElementById('nav-home').classList.add('active');
        document.getElementById('manual-add-btn').style.display = 'block';
        renderFeed(); 
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

// --- GPS Tracking (Dark Map) ---
function initLiveMap() {
    if (mapInstance) return;
    mapInstance = L.map('live-map').setView([0, 0], 2);
    // DARK MAP TILES
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(mapInstance);
    polyline = L.polyline([], {color: '#2979ff', weight: 5}).addTo(mapInstance);
}

function startRun() {
    if (!navigator.geolocation) return alert("GPS not supported.");
    isRunning = true;
    toggleButtons('running');
    document.getElementById('gps-status').innerText = "Locating...";
    timerInterval = setInterval(() => { totalSeconds++; updateDashboard(); }, 1000);

    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude, alt = pos.coords.altitude || 0;
            document.getElementById('gps-status').innerText = `Recording (±${Math.round(pos.coords.accuracy)}m)`;
            
            if (pathCoordinates.length > 0) {
                const last = pathCoordinates[pathCoordinates.length-1];
                const dist = calcDist(last[0], last[1], lat, lng);
                if (dist > 0.005) { 
                    totalDistance += dist; 
                    if (lastAltitude !== null && alt > lastAltitude) elevationGain += (alt - lastAltitude);
                    lastAltitude = alt;
                    pathCoordinates.push([lat, lng, alt, new Date().toISOString()]); 
                    updateMapLine(); 
                }
            } else {
                pathCoordinates.push([lat, lng, alt, new Date().toISOString()]);
                lastAltitude = alt;
                mapInstance.setView([lat, lng], 16);
                L.circleMarker([lat, lng], {radius: 6, color: '#2979ff', fillOpacity: 1}).addTo(mapInstance);
            }
        }, 
        (err) => console.error(err), options
    );
}

function updateMapLine() { 
    if(polyline) { 
        const simplePath = pathCoordinates.map(p => [p[0], p[1]]);
        polyline.setLatLngs(simplePath); 
        mapInstance.setView(simplePath[simplePath.length-1]); 
    }
}

function pauseRun() { 
    isRunning = false; clearInterval(timerInterval); navigator.geolocation.clearWatch(watchId); 
    toggleButtons('paused'); document.getElementById('gps-status').innerText = "Paused";
}
function resumeRun() { startRun(); }

function updateDashboard() {
    document.getElementById('timer').innerText = formatTime(totalSeconds);
    document.getElementById('live-dist').innerText = totalDistance.toFixed(2);
    document.getElementById('live-elev').innerText = Math.round(elevationGain);
    if(totalDistance > 0.05) document.getElementById('live-pace').innerText = formatTime(totalSeconds/totalDistance, true);
}

function toggleButtons(state) {
    document.getElementById('start-btn').style.display = state === 'idle' ? 'block' : 'none';
    document.getElementById('stop-btn').style.display = state === 'running' ? 'block' : 'none';
    document.getElementById('finish-btn').style.display = state === 'paused' ? 'block' : 'none';
    document.getElementById('resume-btn').style.display = state === 'paused' ? 'block' : 'none';
}

// --- BEST EFFORT ALGORITHM ---
function calculateBestEfforts(run) {
    if (!run.path || run.path.length < 2) return [];

    let points = run.path.map(p => ({
        lat: p[0], lng: p[1], time: new Date(p[3]).getTime(), distSoFar: 0
    }));

    let totalDist = 0;
    for (let i = 1; i < points.length; i++) {
        const d = calcDist(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng) * 1000;
        totalDist += d;
        points[i].distSoFar = totalDist;
    }

    let results = [];
    bestEffortDistances.forEach(target => {
        if (totalDist < target.dist) return; 
        let bestTimeMs = Infinity;
        let startIdx = 0;
        let endIdx = 0;
        while (endIdx < points.length) {
            const distCovered = points[endIdx].distSoFar - points[startIdx].distSoFar;
            if (distCovered >= target.dist) {
                const timeTaken = points[endIdx].time - points[startIdx].time;
                if (timeTaken < bestTimeMs) bestTimeMs = timeTaken;
                startIdx++;
            } else {
                endIdx++;
            }
        }
        if (bestTimeMs !== Infinity) {
            results.push({
                label: target.label,
                timeSeconds: bestTimeMs / 1000,
                paceSeconds: (bestTimeMs / 1000) / (target.dist / 1000)
            });
        }
    });
    return results;
}

// --- Activity Details View ---
function openDetailModal(runId) {
    currentDetailRunId = runId;
    const run = runs.find(r => r.id === runId);
    if (!run) return;

    document.getElementById('activity-detail-modal').style.display = 'flex';
    document.getElementById('detail-title').innerText = run.title;
    document.getElementById('detail-dist').innerText = run.distance.toFixed(2) + " km";
    document.getElementById('detail-time').innerText = formatTime(run.seconds);
    document.getElementById('detail-pace').innerText = (run.distance > 0 ? formatTime(run.seconds/run.distance, true) : "0:00") + " /km";
    document.getElementById('detail-elev').innerText = (run.elevation || 0) + " m";
    
    const shoe = profile.gear.find(g => g.id === run.shoeId);
    document.getElementById('detail-shoe').innerText = shoe ? `👟 ${shoe.name}` : "";

    // Map (Dark)
    setTimeout(() => {
        if(detailMapInstance) { detailMapInstance.remove(); detailMapInstance = null; }
        detailMapInstance = L.map('detail-map');
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO' }).addTo(detailMapInstance);
        
        if (run.path && run.path.length > 0) {
            const simplePath = run.path.map(p => [p[0], p[1]]);
            const line = L.polyline(simplePath, {color:'#2979ff', weight:5}).addTo(detailMapInstance);
            detailMapInstance.fitBounds(line.getBounds());
        } else {
            detailMapInstance.setView([0,0], 1);
        }
    }, 100);

    // Best Efforts
    const container = document.getElementById('best-efforts-container');
    container.innerHTML = '';
    
    if (run.path && run.path.length > 0) {
        const efforts = calculateBestEfforts(run);
        if (efforts.length > 0) {
            container.innerHTML = `<div class="effort-row" style="font-weight:bold; border-bottom:1px solid #333; color:var(--text-sub);"><div>Dist</div><div style="text-align:right">Time</div><div style="text-align:right">Pace</div></div>`;
            efforts.forEach(e => {
                container.innerHTML += `
                <div class="effort-row">
                    <div style="font-weight:600;">${e.label}</div>
                    <div style="text-align:right;">${formatTime(e.timeSeconds)}</div>
                    <div style="text-align:right; color:#888;">${formatTime(e.paceSeconds, true)}/km</div>
                </div>`;
            });
        } else {
            container.innerHTML = '<p style="padding:15px; color:#555; text-align:center;">Run too short for achievements.</p>';
        }
    } else {
        container.innerHTML = '<p style="padding:15px; color:#555; text-align:center;">Manual entry - no GPS data.</p>';
    }
}

function closeDetailModal() {
    document.getElementById('activity-detail-modal').style.display = 'none';
}

// --- NEW: DELETE RUN LOGIC ---
function deleteRun(runId) {
    if(!confirm("Are you sure you want to delete this activity? This cannot be undone.")) return;
    
    const runIndex = runs.findIndex(r => r.id === runId);
    if(runIndex === -1) return;

    // 1. Revert Shoe Mileage
    const run = runs[runIndex];
    const shoe = profile.gear.find(g => g.id === run.shoeId);
    if(shoe) {
        shoe.dist = Math.max(0, shoe.dist - run.distance);
        saveProfile();
    }

    // 2. Remove Run
    runs.splice(runIndex, 1);
    localStorage.setItem('strava_runs_v3', JSON.stringify(runs));

    // 3. UI Updates
    closeDetailModal();
    renderFeed();
    updateStats();
    loadProfileUI(); // Updates stats in profile view
}


// --- Data Saving & Editing ---
function openManualEntry() {
    isManualEntry = true; editingRunId = null; 
    document.getElementById('modal-title').innerText = "Manual Entry";
    document.getElementById('manual-fields').style.display = 'block';
    document.getElementById('save-dist-display').style.display = 'none';
    document.getElementById('manual-dist-input').value = '';
    document.getElementById('manual-time-input').value = '';
    document.getElementById('save-title').value = "Run";
    document.getElementById('save-desc').value = "";
    populateShoeSelect();
    document.getElementById('save-modal').style.display = 'flex';
}

function openFinishModal() {
    isManualEntry = false; editingRunId = null; 
    document.getElementById('modal-title').innerText = "Save Activity";
    document.getElementById('manual-fields').style.display = 'none';
    document.getElementById('save-dist-display').style.display = 'block';
    document.getElementById('save-dist-display').innerText = totalDistance.toFixed(2) + " km";
    document.getElementById('save-title').value = getTimeGreeting() + " Run";
    document.getElementById('save-desc').value = "";
    populateShoeSelect();
    document.getElementById('save-modal').style.display = 'flex';
}

function openEditModal(runId) {
    const run = runs.find(r => r.id === runId);
    if(!run) return;
    editingRunId = runId; isManualEntry = false; 
    document.getElementById('modal-title').innerText = "Edit Activity";
    document.getElementById('save-modal').style.display = 'flex';
    document.getElementById('save-title').value = run.title;
    document.getElementById('save-desc').value = run.desc || "";
    populateShoeSelect();
    document.getElementById('save-shoe').value = run.shoeId;
    document.getElementById('save-dist-display').style.display = 'block';
    document.getElementById('save-dist-display').innerText = run.distance.toFixed(2) + " km";
    document.getElementById('manual-fields').style.display = 'none';
    if (document.getElementById('activity-detail-modal').style.display === 'flex') {
        closeDetailModal();
    }
}

function closeSaveModal() { document.getElementById('save-modal').style.display = 'none'; }

function populateShoeSelect() {
    const select = document.getElementById('save-shoe');
    select.innerHTML = '';
    profile.gear.forEach(shoe => {
        const opt = document.createElement('option');
        opt.value = shoe.id; opt.text = shoe.name; select.appendChild(opt);
    });
}

function confirmSave() {
    const title = document.getElementById('save-title').value;
    const desc = document.getElementById('save-desc').value;
    const shoeId = parseInt(document.getElementById('save-shoe').value);
    
    if (editingRunId) {
        const runIndex = runs.findIndex(r => r.id === editingRunId);
        if (runIndex > -1) {
            const oldRun = runs[runIndex];
            if (oldRun.shoeId !== shoeId) {
                const oldShoe = profile.gear.find(g => g.id === oldRun.shoeId);
                if (oldShoe) oldShoe.dist = Math.max(0, oldShoe.dist - oldRun.distance);
                const newShoe = profile.gear.find(g => g.id === shoeId);
                if (newShoe) newShoe.dist += oldRun.distance;
                saveProfile();
            }
            runs[runIndex].title = title; runs[runIndex].desc = desc; runs[runIndex].shoeId = shoeId;
            localStorage.setItem('strava_runs_v3', JSON.stringify(runs));
            closeSaveModal(); 
            renderFeed(); 
            if(currentDetailRunId === editingRunId) openDetailModal(editingRunId);
            editingRunId = null;
            return;
        }
    }

    let dist, secs;
    if (isManualEntry) {
        dist = parseFloat(document.getElementById('manual-dist-input').value) || 0;
        secs = parseFloat(document.getElementById('manual-time-input').value) * 60 || 0;
    } else {
        dist = totalDistance; secs = totalSeconds;
    }
    if (dist <= 0) return alert("Distance > 0 required");

    const run = {
        id: Date.now(), title: title || "Run", desc: desc, date: new Date().toISOString(),
        distance: dist, seconds: secs, elevation: elevationGain, shoeId: shoeId,
        path: isManualEntry ? [] : pathCoordinates
    };
    const shoe = profile.gear.find(g => g.id === shoeId);
    if(shoe) shoe.dist += dist;
    saveProfile();
    runs.unshift(run);
    localStorage.setItem('strava_runs_v3', JSON.stringify(runs));
    closeSaveModal(); resetTracker(); switchTab('home'); renderFeed(); updateStats();
}

function resetTracker() {
    totalSeconds = 0; totalDistance = 0; elevationGain = 0; lastAltitude = null;
    pathCoordinates = []; isRunning = false;
    clearInterval(timerInterval); navigator.geolocation.clearWatch(watchId);
    if(mapInstance) { mapInstance.remove(); mapInstance = null; }
    toggleButtons('idle'); updateDashboard();
    document.getElementById('timer').innerText = "00:00:00";
    document.getElementById('live-dist').innerText = "0.00";
    document.getElementById('live-pace').innerText = "--:--";
    document.getElementById('live-elev').innerText = "0";
}

// --- Feed & Rendering ---
function renderFeed() {
    const container = document.getElementById('feed-container');
    container.innerHTML = '';
    if (runs.length === 0) return container.innerHTML = '<p style="text-align:center; padding:20px; color:#555;">No activities yet.</p>';

    runs.forEach(run => {
        const date = new Date(run.date).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
        
        let html = `
        <div class="activity" onclick="openDetailModal(${run.id})" style="cursor:pointer; padding:15px; margin-bottom:10px; background:var(--bg-card); border-radius:12px; border:1px solid var(--border);">
            <div class="btn-edit-activity" onclick="event.stopPropagation(); openEditModal(${run.id})">✎</div>
            
            <div class="user-header">
                <div class="avatar-small">
                     ${profile.photo ? `<img src="${profile.photo}">` : profile.name.charAt(0)}
                </div>
                <div>
                    <h3 style="font-size:1rem; font-weight:800; color:var(--text-main);">${profile.name}</h3>
                    <span style="font-size:0.75rem; color:var(--text-sub);">${date}</span>
                </div>
            </div>
            <h2 style="font-size:1.1rem; margin-top:10px; font-weight:bold; color:var(--text-main);">${run.title}</h2>
            <div class="run-stats">
                <div class="run-stat"><label>Dist</label>${run.distance.toFixed(2)} km</div>
                <div class="run-stat"><label>Pace</label>${formatTime(run.seconds/run.distance, true)} /km</div>
                <div class="run-stat"><label>Time</label>${formatTime(run.seconds)}</div>
            </div>
        </div>`;
        container.innerHTML += html;
    });
}

function exportGPX(runId) {
    const rId = runId || currentRunIdForExport;
    if(!rId) return;
    const run = runs.find(r => r.id === rId);
    if(!run || !run.path || run.path.length === 0) return alert("No GPS data.");
    
    let gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="RunStrava"><trk><name>${run.title}</name><trkseg>`;
    run.path.forEach(pt => {
        gpx += `<trkpt lat="${pt[0]}" lon="${pt[1]}"><ele>${pt[2]||0}</ele><time>${pt[3]||new Date().toISOString()}</time></trkpt>`;
    });
    gpx += `</trkseg></trk></gpx>`;
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    a.download = `run_${run.id}.gpx`;
    a.click();
}

// --- Profile & Helpers ---
function loadProfileUI() {
    document.getElementById('profile-name').innerText = profile.name;
    document.getElementById('profile-location').innerText = profile.location;
    if(profile.photo) {
        document.getElementById('profile-img').src = profile.photo;
        document.getElementById('profile-img').style.display = 'block';
        document.getElementById('profile-initial').style.display = 'none';
    }
    let d=0; runs.forEach(r => d+=r.distance);
    document.getElementById('all-time-km').innerText = d.toFixed(1);
    document.getElementById('all-time-runs').innerText = runs.length;
    
    const container = document.getElementById('gear-container');
    container.innerHTML = '';
    profile.gear.forEach(shoe => {
        container.innerHTML += `<div class="gear-item"><div class="gear-icon">👟</div><div style="flex:1;"><div style="font-weight:bold; color:var(--text-main);">${shoe.name}</div><div style="color:var(--text-sub); font-size:0.9rem;">${shoe.dist.toFixed(1)} km</div></div></div>`;
    });

    // PRS
    const prContainer = document.getElementById('pr-container');
    prContainer.innerHTML = '';
    let bests = {};
    runs.forEach(run => {
        if(run.path && run.path.length > 0) {
            const efforts = calculateBestEfforts(run);
            efforts.forEach(e => {
                if (!bests[e.label] || e.timeSeconds < bests[e.label].timeSeconds) {
                    bests[e.label] = { ...e, date: run.date };
                }
            });
        }
    });
    const labelsOrder = bestEffortDistances.map(d => d.label);
    let hasPrs = false;
    labelsOrder.forEach(label => {
        if(bests[label]) {
            hasPrs = true;
            const rec = bests[label];
            const dateStr = new Date(rec.date).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
            prContainer.innerHTML += `
            <div class="effort-row">
                <div style="font-weight:bold;">${label}</div>
                <div style="text-align:right; font-weight:600;">${formatTime(rec.timeSeconds)}</div>
                <div style="text-align:right; font-size:0.8rem; color:var(--text-sub);">${dateStr}</div>
            </div>`;
        }
    });
    if(!hasPrs) prContainer.innerHTML = '<p style="text-align:center; color:#555; padding:10px;">No GPS records yet.</p>';
}

function openProfileModal() {
    document.getElementById('edit-profile-name').value = profile.name;
    document.getElementById('edit-profile-loc').value = profile.location;
    document.getElementById('profile-modal').style.display = 'flex';
}
function closeProfileModal() { document.getElementById('profile-modal').style.display = 'none'; }
function saveProfileChanges() {
    profile.name = document.getElementById('edit-profile-name').value;
    profile.location = document.getElementById('edit-profile-loc').value;
    saveProfile(); loadProfileUI(); renderFeed(); closeProfileModal();
}
function handleAvatarUpload(input) {
    if(input.files[0]) {
        const reader = new FileReader();
        reader.onload = e => { profile.photo = e.target.result; saveProfile(); loadProfileUI(); renderFeed(); }
        reader.readAsDataURL(input.files[0]);
    }
}
function addShoe() {
    const name = prompt("Shoe Name:");
    if(name) { profile.gear.push({id:Date.now(), name:name, dist:0}); saveProfile(); loadProfileUI(); }
}
function saveProfile() { localStorage.setItem('strava_profile_v3', JSON.stringify(profile)); }

function updateStats() {
    let d=0, t=0; runs.forEach(r => { d+=r.distance; t+=r.seconds; });
    document.getElementById('weekly-km').innerText = d.toFixed(1);
    document.getElementById('weekly-runs').innerText = runs.length;
    document.getElementById('weekly-time').innerText = Math.floor(t/3600)+"h "+Math.floor((t%3600)/60)+"m";
}

function calcDist(lat1, lon1, lat2, lon2) {
    const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
function formatTime(s, pace=false) {
    if(!s||s===Infinity) return "00:00";
    s = Math.round(s);
    const m = Math.floor((s%3600)/60).toString().padStart(2,'0'), sec = (s%60).toString().padStart(2,'0');
    if(pace) return `${Math.floor(s/60)}:${sec}`;
    return (Math.floor(s/3600)>0 ? Math.floor(s/3600)+":" : "") + `${m}:${sec}`;
}
function getTimeGreeting() { const h=new Date().getHours(); return h<12?"Morning":h<18?"Afternoon":"Evening"; }
function resetData() { if(confirm("Clear all data?")) { localStorage.clear(); location.reload(); } }