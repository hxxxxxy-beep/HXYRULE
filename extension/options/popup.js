import { helperHealthViaBackground } from '../lib/helper.js';

document.getElementById('opts').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('health').addEventListener('click', async () => {
  const st = document.getElementById('st');
  try {
    const h = await helperHealthViaBackground();
    st.className = 'ok';
    st.textContent = `Online · ${h.directory}`;
  } catch (err) {
    st.className = 'bad';
    st.textContent = String(err.message || err);
  }
});
