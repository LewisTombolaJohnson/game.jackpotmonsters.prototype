// This file is used to play the slash-attack.gif overlay for critical hits
function playSlashAttackOverlay() {
  // Play the gif over the monster only, only one loop at a time
  const monsterWrap = document.getElementById('monsterSpriteWrap');
  if (!monsterWrap) return;
  let overlay = document.getElementById('slashAttackOverlay');
  if (overlay) {
    // If already playing, restart the animation cleanly
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    // Wait a frame to ensure DOM update
    setTimeout(() => {
      overlay.innerHTML = `<img src="assets/slash-attack.gif" alt="Critical Hit!" style="width: 60%; max-width: 420px; min-width: 120px; pointer-events:none; filter: drop-shadow(0 0 24px #fff8);">`;
      overlay.style.display = 'flex';
      setTimeout(() => { overlay.style.display = 'none'; }, 750);
    }, 20);
  } else {
    overlay = document.createElement('div');
    overlay.id = 'slashAttackOverlay';
    overlay.style.position = 'absolute';
    overlay.style.left = '50%';
    overlay.style.top = '0';
    overlay.style.transform = 'translateX(-50%)';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '100';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.innerHTML = `<img src="assets/slash-attack.gif" alt="Critical Hit!" style="width: 60%; max-width: 420px; min-width: 120px; pointer-events:none; filter: drop-shadow(0 0 24px #fff8);">`;
    monsterWrap.appendChild(overlay);
  setTimeout(() => { overlay.style.display = 'none'; }, 750);
  }
}
