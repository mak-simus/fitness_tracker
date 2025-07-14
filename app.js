// App State
let isTracking = false;
let startTime = null;
let totalDistance = 0;
let currentSpeed = 0;
let routePoints = []; // Stores original lat/lon for dynamic mapping
let lastCoords = null;
let watchId = null;
let timerInterval = null;
let speedHistory = [];

let logicalCanvasWidth = 0;
let logicalCanvasHeight = 0;

// DOM Elements
const canvas = document.getElementById('routeCanvas');
const ctx = canvas.getContext('2d');
const canvasOverlay = document.getElementById('canvasOverlay');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const distanceEl = document.getElementById('distance');
const speedEl = document.getElementById('speed');
const durationEl = document.getElementById('duration');
const networkAlert = document.getElementById('networkAlert');
const workoutSummary = document.getElementById('workoutSummary');
const toast = document.getElementById('toast');

// Initialize Canvas
function initCanvas() {
    const rect = canvas.getBoundingClientRect();
    logicalCanvasWidth = rect.width;
    logicalCanvasHeight = rect.height;

    canvas.width = logicalCanvasWidth * window.devicePixelRatio;
    canvas.height = logicalCanvasHeight * window.devicePixelRatio;

    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    
    drawRoute(); // Redraw route if canvas size changes
}

/**
 * Converts geographic coordinates (lat, lon) to canvas X/Y coordinates.
 * This function dynamically scales and translates the points to fit the current
 * geographic bounds of the route within the canvas, while preserving aspect ratio.
 *
 * @param {number} lat Latitude of the point.
 * @param {number} lon Longitude of the point.
 * @param {object} bounds An object containing minLat, maxLat, minLon, maxLon of the entire route.
 * @param {number} canvasWidth The width of the canvas in pixels.
 * @param {number} canvasHeight The height of the canvas in pixels.
 * @returns {object} An object {x, y} representing the canvas coordinates.
 */
function latLonToCanvasXY(lat, lon, bounds, canvasWidth, canvasHeight) {
    const { minLat, maxLat, minLon, maxLon } = bounds;

    // Geographic width and height in degrees
    const geoWidthDeg = maxLon - minLon;
    const geoHeightDeg = maxLat - minLat;

    // Approximate meters per degree (at mid-latitude to reduce distortion)
    const midLatRad = ((minLat + maxLat) / 2) * Math.PI / 180;
    const METERS_PER_DEGREE_LAT = 111320; // Approx at equator
    const METERS_PER_DEGREE_LON = METERS_PER_DEGREE_LAT * Math.cos(midLatRad);

    // Geographic width and height in meters
    const geoWidthMeters = geoWidthDeg * METERS_PER_DEGREE_LON;
    const geoHeightMeters = geoHeightDeg * METERS_PER_DEGREE_LAT;

    // Calculate initial scale factors
    let scaleX = canvasWidth / geoWidthMeters;
    let scaleY = canvasHeight / geoHeightMeters;

    // Handle very small or zero geographic extent (e.g., stationary user, single point)
    const MIN_GEO_EXTENT_METERS = 50; // Minimum geographic extent to show, e.g., 50 meters
    if (geoWidthMeters < MIN_GEO_EXTENT_METERS && geoHeightMeters < MIN_GEO_EXTENT_METERS) {
        // If movement is very small, fix the scale to show a small area clearly
        // This ensures a dot or tiny movement is always visible and not scaled to infinity.
        scaleX = canvasWidth / MIN_GEO_EXTENT_METERS;
        scaleY = canvasHeight / MIN_GEO_EXTENT_METERS;
    }

    // Choose the smaller scale to ensure the entire route fits within the canvas.
    // This maintains the aspect ratio of the geographic area on the canvas.
    let scale = Math.min(scaleX, scaleY);

    // If scale is still problematic (e.g., initial state with no points or extreme values)
    if (isNaN(scale) || !isFinite(scale) || scale === 0) {
        scale = 1; // Default to a reasonable scale if calculation fails
    }

    // Calculate geographic center
    const geoCenterX = (minLon + maxLon) / 2;
    const geoCenterY = (minLat + maxLat) / 2;

    // Convert current point's geographic coordinates to pixel offset from geographic center
    const offsetXFromCenter = (lon - geoCenterX) * METERS_PER_DEGREE_LON * scale;
    const offsetYFromCenter = (lat - geoCenterY) * METERS_PER_DEGREE_LAT * scale;

    // Map to canvas coordinates, ensuring North is up (Y-axis inverted for canvas)
    // Canvas X = canvas_center_x + offset_x
    // Canvas Y = canvas_center_y - offset_y (because canvas Y increases downwards)
    const canvasX = (canvasWidth / 2) + offsetXFromCenter;
    const canvasY = (canvasHeight / 2) - offsetYFromCenter;

    return { x: canvasX, y: canvasY };
}


function drawRoute() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (routePoints.length === 0) {
        // Nothing to draw yet
        return;
    }

    // Calculate bounds for dynamic scaling
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;

    routePoints.forEach(p => {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon);
        maxLon = Math.max(maxLon, p.lon);
    });

    // --- IMPORTANT: Handle cases with single point or no movement ---
    // Add a small buffer to min/max if they are the same (no movement yet or very precise location).
    // This prevents division by zero or infinite scale and ensures a visible area.
    const LAT_LON_BUFFER_DEG = 0.0002; // Roughly 22 meters. Adjust as needed.
    if (minLat === maxLat) {
        minLat -= LAT_LON_BUFFER_DEG;
        maxLat += LAT_LON_BUFFER_DEG;
    }
    if (minLon === maxLon) {
        minLon -= LAT_LON_BUFFER_DEG;
        maxLon += LAT_LON_BUFFER_DEG;
    }

    const currentBounds = { minLat, maxLat, minLon, maxLon };

    // Convert all route points to canvas coordinates with dynamic scaling
    const canvasRoute = routePoints.map(p => latLonToCanvasXY(p.lat, p.lon, currentBounds, logicalCanvasWidth, logicalCanvasHeight));

    // Draw the route line if there's more than one point
    if (canvasRoute.length > 1) {
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(canvasRoute[0].x, canvasRoute[0].y);
        for (let i = 1; i < canvasRoute.length; i++) {
            ctx.lineTo(canvasRoute[i].x, canvasRoute[i].y);
        }
        ctx.stroke();
    }

    // Start point (always draw if points exist)
    const startPoint = canvasRoute[0];
    ctx.fillStyle = '#4CAF50'; // Green for start
    ctx.beginPath();
    ctx.arc(startPoint.x, startPoint.y, 6, 0, 2 * Math.PI);
    ctx.fill();

    // Current point (always draw if points exist)
    const lastPoint = canvasRoute[canvasRoute.length - 1];
    ctx.fillStyle = '#f44336'; // Red for current
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 4, 0, 2 * Math.PI);
    ctx.fill();
}


function updateStats() {
    distanceEl.textContent = totalDistance.toFixed(2);
    speedEl.textContent = currentSpeed.toFixed(1);
    if (startTime) {
        const elapsed = Date.now() - startTime;
        const h = Math.floor(elapsed / 3600000);
        const m = Math.floor((elapsed % 3600000) / 60000);
        const s = Math.floor((elapsed % 60000) / 1000);
        durationEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
}

function startTracking() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported by your browser.');
        return;
    }
    isTracking = true;
    startTime = Date.now();
    totalDistance = 0;
    currentSpeed = 0;
    routePoints = [];
    lastCoords = null;
    speedHistory = [];

    startBtn.disabled = true;
    stopBtn.disabled = false;
    canvasOverlay.style.display = 'none';
    workoutSummary.classList.remove('show');

    watchId = navigator.geolocation.watchPosition(handlePositionUpdate, handleError, {
        enableHighAccuracy: true,
        maximumAge: 100,
        timeout: 10000
    });

    timerInterval = setInterval(updateStats, 1000);
    showToast('Tracking started!');
}

function handlePositionUpdate(position) {
    const { latitude, longitude, timestamp } = position.coords;

    // Store raw lat/lon for dynamic mapping
    routePoints.push({ lat: latitude, lon: longitude });

    if (!lastCoords) {
        lastCoords = { lat: latitude, lon: longitude, timestamp };
        drawRoute(); // Draw initial point
        return;
    }

    const distance = haversineDistance(lastCoords.lat, lastCoords.lon, latitude, longitude);
    totalDistance += distance;
    const timeDiff = (timestamp - lastCoords.timestamp) / 1000;

    if (timeDiff > 0) {
        currentSpeed = (distance / timeDiff) * 3.6; // m/s to km/h
        speedHistory.push(currentSpeed);
        if (speedHistory.length > 10) speedHistory.shift(); // Keep last 10 speeds for average
    }

    lastCoords = { lat: latitude, lon: longitude, timestamp };
    drawRoute(); // Redraw the route with the new point
    updateStats();
}

function handleError(error) {
    let message = 'Unknown error occurred';
    switch (error.code) {
        case error.PERMISSION_DENIED:
            message = 'Permission denied for Geolocation. Please enable location access.';
            break;
        case error.POSITION_UNAVAILABLE:
            message = 'Location information is unavailable. Try again later.';
            break;
        case error.TIMEOUT:
            message = 'The request to get user location timed out. Check your GPS signal.';
            break;
        default:
            message = 'An unknown error occurred while fetching location.';
    }
    showToast(message);
    stopTracking(); // Stop tracking on error
}

/**
 * Calculates the distance between two points on Earth using the Haversine formula.
 * @param {number} lat1 Latitude of point 1 in degrees.
 * @param {number} lon1 Longitude of point 1 in degrees.
 * @param {number} lat2 Latitude of point 2 in degrees.
 * @param {number} lon2 Longitude of point 2 in degrees.
 * @returns {number} Distance in meters.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    // distance between latitudes
    // and longitudes
    let dLat = (lat2 - lat1) * Math.PI / 180.0;
    let dLon = (lon2 - lon1) * Math.PI / 180.0;
        
    // convert to radiansa
    lat1 = (lat1) * Math.PI / 180.0;
    lat2 = (lat2) * Math.PI / 180.0;
    
    // apply formulae
    let a = Math.pow(Math.sin(dLat / 2), 2) + 
                  Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
    let rad = 6371;
    let c = 2 * Math.asin(Math.sqrt(a));
    return rad * c;
}

function stopTracking() {
    isTracking = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;

    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (timerInterval) clearInterval(timerInterval);

    showWorkoutSummary();
    saveWorkoutOffline();
    showToast('Workout completed! Data saved offline.');

    // Display "Workout completed" message on canvas overlay
    canvasOverlay.style.display = 'flex'; // Use flexbox for centering text
    canvasOverlay.style.alignItems = 'center';
    canvasOverlay.style.justifyContent = 'center';
    canvasOverlay.textContent = 'Workout completed';
}

function showWorkoutSummary() {
    const avgSpeed = speedHistory.length > 0 ? speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length : 0;
    // Calorie estimation (very rough: e.g., 60 calories per km for a generic person)
    const calories = Math.round(totalDistance / 1000 * 60);
    const duration = Date.now() - startTime;
    const h = Math.floor(duration / 3600000);
    const m = Math.floor((duration % 3600000) / 60000);
    const s = Math.floor((duration % 60000) / 1000);

    document.getElementById('summaryDistance').textContent = `${(totalDistance).toFixed(2)} km`;
    document.getElementById('summaryAvgSpeed').textContent = `${avgSpeed.toFixed(1)} km/h`;
    document.getElementById('summaryCalories').textContent = calories.toString();
    document.getElementById('summaryDuration').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    workoutSummary.classList.add('show');
}

function saveWorkoutOffline() {
    const data = {
        timestamp: new Date().toISOString(),
        distance: totalDistance,
        duration: Date.now() - startTime,
        avgSpeed: speedHistory.length > 0 ? speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length : 0,
        route: routePoints // Save raw route points for potential future re-rendering or analysis
    };
    try {
        const saved = JSON.parse(localStorage.getItem('workouts') || '[]');
        saved.push(data);
        localStorage.setItem('workouts', JSON.stringify(saved));
        showToast('Workout data saved offline!');
    } catch (e) {
        console.error("Error saving workout to localStorage:", e);
        showToast('Error saving workout data offline.');
    }
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function updateNetworkStatus() {
    const isOnline = navigator.onLine;
    // The navigator.connection API is non-standard and varies by browser.
    // It's mostly for informational purposes and might not be available.
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    if (!isOnline) {
        networkAlert.classList.add('show', 'offline');
        document.getElementById('networkMessage').textContent = 'You are offline';
    } else if (connection && connection.effectiveType && ['slow-2g', '2g', '3g'].includes(connection.effectiveType)) {
        networkAlert.classList.add('show');
        networkAlert.classList.remove('offline');
        document.getElementById('networkMessage').textContent = `Poor network connection detected (${connection.effectiveType})`;
    } else {
        networkAlert.classList.remove('show', 'offline');
    }
}

// Event Listeners
startBtn.addEventListener('click', startTracking);
stopBtn.addEventListener('click', stopTracking);
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
window.addEventListener('resize', initCanvas); // Recalculate canvas size and redraw on resize

// Initializations
initCanvas();
updateNetworkStatus();
setInterval(updateNetworkStatus, 5000); // Check network status periodically