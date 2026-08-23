const $ = id => document.getElementById(id);

function setState(data) {
  const live = Boolean(data.gmod);
  $('connection').textContent = live ? 'Live' : 'Signal delayed';
  $('connection').className = `pill ${live ? 'live' : 'waiting'}`;
  $('pulse').className = `pulse ${live ? 'live' : ''}`;
  $('round').textContent = data.server?.round || 'Waiting for server signal';
  $('players').textContent = `${data.server?.players ?? 0} / ${data.server?.maxPlayers ?? 0}`;
  $('map').textContent = data.server?.map || 'unknown';
  $('bridge').textContent = live ? 'Connected' : 'Waiting';
  $('updated').textContent = data.server?.lastSignalAt
    ? `Last signal ${new Date(data.server.lastSignalAt).toLocaleTimeString()}`
    : 'Checking the live GMod bridge...';
}

async function refresh() {
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setState(await response.json());
  } catch (error) {
    $('connection').textContent = 'Offline';
    $('connection').className = 'pill waiting';
    $('bridge').textContent = 'Unavailable';
    $('updated').textContent = 'The activity could not reach the Notorious bridge.';
    console.warn('[Activity] Health check failed:', error.message);
  }
}

refresh();
setInterval(refresh, 15000);
