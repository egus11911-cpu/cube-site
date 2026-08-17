(function(){
  "use strict";

  const SPACING = 0.88;
  const CUBIE_SIZE = 0.80;
  const DRAG_THRESHOLD = 0.32;
  const MOVE_DURATION = 80;
  const SCRAMBLE_DURATION = 40;
  const SCRAMBLE_MOVES = 22;

  const COLORS = {
    right:  0xe03e2f,
    left:   0xf78104,
    up:     0xffffff,
    down:   0xf1c40f,
    front:  0x2ecc71,
    back:   0x3498db,
    inner:  0xd4cec3
  };

  const wrap = document.getElementById('canvas-wrap');
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, wrap.clientWidth / wrap.clientHeight, 0.1, 100);

  // 화면 비율에 따라 큐브가 보이는 기본/최소/최대 거리(radius)를 다르게 잡는다.
  // 세로로 긴 휴대폰 화면일수록 더 멀리서 보여줘서, 큐브가 화면을 꽉 채워
  // 손가락으로 층을 정확히 집기 어려워지는 문제를 줄인다.
  function computeRadiusBounds(){
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const aspect = w / Math.max(h, 1);
    if(aspect < 0.75)  return { min: 9,   max: 20, base: 13.5 }; // 세로로 긴 휴대폰
    if(aspect < 1.05)  return { min: 7,   max: 16, base: 10.5 }; // 정사각형에 가까운 화면
    return              { min: 5.5, max: 13, base: 8.4 };        // 데스크톱 / 가로로 넓은 화면
  }

  let radiusBounds = computeRadiusBounds();
  let radius = radiusBounds.base;
  const camDir = new THREE.Vector3(0, 0, 1);
  const camUp = new THREE.Vector3(0, 1, 0);
  orthonormalizeCamera();

  function orthonormalizeCamera(){
    camDir.normalize();
    camUp.addScaledVector(camDir, -camUp.dot(camDir));
    camUp.normalize();
  }

  function currentRightAxis(){
    const viewDir = camDir.clone().negate();
    return new THREE.Vector3().crossVectors(viewDir, camUp).normalize();
  }

  function updateCameraPosition(){
    camera.position.copy(camDir.clone().multiplyScalar(radius));
    camera.up.copy(camUp);
    camera.lookAt(0, 0, 0);
  }
  updateCameraPosition();

  function easeInOutQuad(t){ return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; }

  // "임팩트" 있는 스냅 느낌을 위한 back-ease (살짝 넘어갔다가 정확히 제자리로)
  function easeOutBack(t){
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  let cameraAnimating = false;
  function animateCamera(axis, totalAngle, duration){
    return new Promise(resolve => {
      if(cameraAnimating){ resolve(); return; }
      cameraAnimating = true;
      const startDir = camDir.clone();
      const startUp = camUp.clone();
      const t0 = performance.now();
      function frame(now){
        const t = Math.min((now - t0) / duration, 1);
        const angle = totalAngle * easeInOutQuad(t);
        camDir.copy(startDir).applyAxisAngle(axis, angle);
        camUp.copy(startUp).applyAxisAngle(axis, angle);
        updateCameraPosition();
        if(t < 1){
          requestAnimationFrame(frame);
        } else {
          orthonormalizeCamera();
          updateCameraPosition();
          cameraAnimating = false;
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  const CAMERA_STEP_DURATION = 140;

  function orbitUp(dir){
    return animateCamera(currentRightAxis(), -dir * Math.PI/2, CAMERA_STEP_DURATION);
  }
  function orbitSide(dir){
    return animateCamera(camUp.clone(), dir * Math.PI/2, CAMERA_STEP_DURATION);
  }
  function rollView(dir){
    return animateCamera(camDir.clone(), -dir * Math.PI/2, CAMERA_STEP_DURATION);
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  wrap.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(6, 10, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xddeeff, 0.4);
  fill.position.set(-8, -4, -6);
  scene.add(fill);

  window.addEventListener('resize', () => {
    camera.aspect = wrap.clientWidth / wrap.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);

    // 화면 방향이 바뀌거나(세로<->가로) 크기가 바뀌면 줌 범위를 다시 계산하고,
    // 현재 값이 새 범위를 벗어나면 안쪽으로 당겨준다 (사용자가 준 줌은 최대한 유지).
    radiusBounds = computeRadiusBounds();
    radius = clamp(radius, radiusBounds.min, radiusBounds.max);
    updateCameraPosition();
  });

  const cubies = [];
  const cubeGroup = new THREE.Group();
  scene.add(cubeGroup);

  function makeMaterials(x, y, z){
    const c = [
      x ===  1 ? COLORS.right : COLORS.inner,
      x === -1 ? COLORS.left  : COLORS.inner,
      y ===  1 ? COLORS.up    : COLORS.inner,
      y === -1 ? COLORS.down  : COLORS.inner,
      z ===  1 ? COLORS.front : COLORS.inner,
      z === -1 ? COLORS.back  : COLORS.inner,
    ];
    return c.map(hex => new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.35,
      metalness: 0.05,
      emissive: 0xff7a3d, // 회전 시 발광 이펙트용 색상 (평소엔 emissiveIntensity 0으로 안 보임)
      emissiveIntensity: 0
    }));
  }

  function buildCube(){
    cubies.splice(0).forEach(c => cubeGroup.remove(c));
    const geometry = new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE);
    for(let x=-1; x<=1; x++){
      for(let y=-1; y<=1; y++){
        for(let z=-1; z<=1; z++){
          const mats = makeMaterials(x, y, z);
          const mesh = new THREE.Mesh(geometry, mats);
          mesh.position.set(x * SPACING, y * SPACING, z * SPACING);
          mesh.userData.gridPos = new THREE.Vector3(x, y, z);
          mesh.userData.rotMat = new THREE.Matrix4().identity();
          cubeGroup.add(mesh);
          cubies.push(mesh);
        }
      }
    }
  }
  buildCube();

  function elemRotMatrix(axis, dir){
    const m = new THREE.Matrix4();
    if(axis === 'x'){
      if(dir === 1) m.set(1,0,0,0,  0,0,-1,0,  0,1,0,0,  0,0,0,1);
      else          m.set(1,0,0,0,  0,0,1,0,   0,-1,0,0, 0,0,0,1);
    } else if(axis === 'y'){
      if(dir === 1) m.set(0,0,1,0,  0,1,0,0,  -1,0,0,0,  0,0,0,1);
      else          m.set(0,0,-1,0, 0,1,0,0,   1,0,0,0,  0,0,0,1);
    } else {
      if(dir === 1) m.set(0,-1,0,0, 1,0,0,0,   0,0,1,0,  0,0,0,1);
      else          m.set(0,1,0,0, -1,0,0,0,   0,0,1,0,  0,0,0,1);
    }
    return m;
  }

  let animating = false;

  // 임팩트: 회전이 끝난 층이 살짝 부풀었다가 원래 크기로 돌아오는 스케일 펄스
  function pulseCubies(list){
    const duration = 160;
    const peak = 1.07;
    const t0 = performance.now();
    function frame(now){
      const t = Math.min((now - t0) / duration, 1);
      const s = t < 0.5
        ? 1 + (peak - 1) * (t * 2)
        : peak - (peak - 1) * ((t - 0.5) * 2);
      list.forEach(c => c.scale.setScalar(s));
      if(t < 1) requestAnimationFrame(frame);
      else list.forEach(c => c.scale.setScalar(1));
    }
    requestAnimationFrame(frame);
  }

  function rotateLayer(axis, layer, dir, opts){
    opts = opts || {};
    return new Promise(resolve => {
      animating = true;
      const layerCubies = cubies.filter(c => c.userData.gridPos[axis] === layer);
      const pivot = new THREE.Group();
      scene.add(pivot);
      layerCubies.forEach(c => {
        cubeGroup.remove(c);
        pivot.add(c);
      });

      const axisVec = new THREE.Vector3(axis==='x'?1:0, axis==='y'?1:0, axis==='z'?1:0);
      const angle = dir * Math.PI / 2;
      const duration = opts.duration || MOVE_DURATION;
      const t0 = performance.now();

      function frame(now){
        const t = Math.min((now - t0) / duration, 1);
        pivot.quaternion.setFromAxisAngle(axisVec, angle * easeOutBack(t));

        if(!opts.silent){
          // 임팩트: 돌아가는 층이 회전 중간에 가장 밝고, 시작/끝에서는 은은하게 사그라드는 발광 효과
          const glow = Math.sin(Math.min(t, 1) * Math.PI) * 0.85;
          layerCubies.forEach(c => {
            c.material.forEach(m => { m.emissiveIntensity = glow; });
          });
        }

        if(t < 1){
          requestAnimationFrame(frame);
        } else {
          const elemM = elemRotMatrix(axis, dir);
          layerCubies.forEach(c => {
            pivot.remove(c);
            const oldGrid = c.userData.gridPos;
            const newGrid = new THREE.Vector3(oldGrid.x, oldGrid.y, oldGrid.z).applyMatrix4(elemM);
            newGrid.set(Math.round(newGrid.x), Math.round(newGrid.y), Math.round(newGrid.z));
            const newRotMat = elemM.clone().multiply(c.userData.rotMat);
            c.userData.gridPos = newGrid;
            c.userData.rotMat = newRotMat;
            c.position.copy(newGrid.clone().multiplyScalar(SPACING));
            c.quaternion.setFromRotationMatrix(newRotMat);
            c.material.forEach(m => { m.emissiveIntensity = 0; });
            cubeGroup.add(c);
          });
          scene.remove(pivot);
          animating = false;

          if(!opts.silent){
            pulseCubies(layerCubies);
            if(opts.isUndo){
              // moveCount/HUD/기록 갱신은 undoMove()에서 직접 처리한다
              // (되돌리기가 "새 이동"으로 집계되지 않도록)
            } else {
              if(solvedState){
                // 완성된 뒤에도 계속 돌리는 경우: '완성 상태' 플래그를 풀어줘야
                // (특히 놀이 모드에서) 일시정지 등이 계속 막히지 않는다.
                solvedState = false;
                document.getElementById('win-overlay').classList.remove('show');
                startTimerIfNeeded();
              }
              moveHistory.push({ axis, layer, dir });
              updateUndoButton();
              moveCount++;
              updateHUD();
              startTimerIfNeeded();
              checkSolved();
            }
          }
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  const LOCAL_NORMALS = [
    new THREE.Vector3(1,0,0), new THREE.Vector3(-1,0,0),
    new THREE.Vector3(0,1,0), new THREE.Vector3(0,-1,0),
    new THREE.Vector3(0,0,1), new THREE.Vector3(0,0,-1)
  ];
  const FACES = [
    { axis:'x', sign: 1 }, { axis:'x', sign:-1 },
    { axis:'y', sign: 1 }, { axis:'y', sign:-1 },
    { axis:'z', sign: 1 }, { axis:'z', sign:-1 }
  ];

  function colorFacing(cubie, worldDir){
    let best = -1, bestDot = -Infinity;
    for(let i=0;i<6;i++){
      const n = LOCAL_NORMALS[i].clone().applyMatrix4(cubie.userData.rotMat);
      const d = n.dot(worldDir);
      if(d > bestDot){ bestDot = d; best = i; }
    }
    return cubie.material[best].color.getHex();
  }

  function isSolved(){
    for(const f of FACES){
      const worldDir = new THREE.Vector3(
        f.axis==='x'?f.sign:0, f.axis==='y'?f.sign:0, f.axis==='z'?f.sign:0
      );
      const layerCubies = cubies.filter(c => c.userData.gridPos[f.axis] === f.sign);
      const first = colorFacing(layerCubies[0], worldDir);
      for(let i=1;i<layerCubies.length;i++){
        if(colorFacing(layerCubies[i], worldDir) !== first) return false;
      }
    }
    return true;
  }

  let currentMode = 'play'; // 'play' | 'timeattack'
  let isPaused = false;
  let gameStarted = false; // 처음 "게임 시작"을 누르기 전까지는 조작을 막아둔다
  let bestTime = null; // ms, 타임어택 모드 전용 (세션 동안만 유지)
  let moveHistory = [];

  let solvedState = false;
  function checkSolved(){
    if(moveCount === 0) return;
    if(isSolved()){
      solvedState = true;
      stopTimer();
      const finalMs = timerElapsed;

      if(currentMode === 'timeattack'){
        document.getElementById('win-time').textContent = formatTime(finalMs);
        document.getElementById('win-moves').textContent = String(moveCount);
        document.getElementById('win-sub').textContent = '타임어택 클리어';

        const badge = document.getElementById('win-badge');
        if(bestTime === null || finalMs < bestTime){
          bestTime = finalMs;
          document.getElementById('best-value').textContent = formatTime(bestTime);
          badge.classList.add('show');
        } else {
          badge.classList.remove('show');
        }
        document.getElementById('win-overlay').classList.add('show');
      }
      // 놀이 모드에서는 완성해도 축하 팝업을 띄우지 않는다 (조용히 타이머만 멈춘다)
    }
  }

  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();

  let dragMode = null;
  let lastPointer = { x:0, y:0 };
  let dragStartCubie = null, dragStartPoint = null, dragNormal = null, dragPlane = null;

  function setMouseNDC(e){
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function onPointerDown(e){
    if(animating || isPaused || !gameStarted || activeTouchCount >= 2) return;
    setMouseNDC(e);
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(cubies);

    if(hits.length > 0){
      const hit = hits[0];
      dragMode = 'pending-layer';
      dragStartCubie = hit.object;
      dragStartPoint = hit.point.clone();
      dragNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(dragNormal, dragStartPoint);
      wrap.classList.remove('grabbing');
    } else {
      dragMode = 'camera';
      lastPointer = { x: e.clientX, y: e.clientY };
      wrap.classList.add('grabbing');
    }
  }

  function onPointerMove(e){
    if(dragMode === 'camera'){
      if(cameraAnimating) return;
      const dx = e.clientX - lastPointer.x;
      const dy = e.clientY - lastPointer.y;
      lastPointer = { x: e.clientX, y: e.clientY };

      const yaw = -dx * 0.005;
      const pitch = -dy * 0.005;

      // 트랙볼 방식: 좌우/상하 모두 "현재" 카메라의 로컬 축(up, right) 기준으로 회전시킨다.
      // 고정된 월드 Y축을 기준으로 좌우 회전을 하면 위/아래쪽 면을 정면으로 볼 때
      // camDir이 그 축과 거의 나란해져서 좌우 드래그가 아무 효과가 없어지는 문제가 있었다.
      // 로컬 축 기준으로 하면 극(위/아래 면) 근처에서도 항상 자연스럽게 반응한다.
      camDir.applyAxisAngle(camUp, yaw);

      const right = currentRightAxis();
      camDir.applyAxisAngle(right, pitch);
      camUp.applyAxisAngle(right, pitch);

      orthonormalizeCamera();
      updateCameraPosition();
    } else if(dragMode === 'pending-layer'){
      setMouseNDC(e);
      raycaster.setFromCamera(mouseNDC, camera);
      const pt = new THREE.Vector3();
      const hitPlane = raycaster.ray.intersectPlane(dragPlane, pt);
      if(!hitPlane) return;
      const dragVec = pt.clone().sub(dragStartPoint);
      if(dragVec.length() > DRAG_THRESHOLD){
        const rotAxisRaw = new THREE.Vector3().crossVectors(dragNormal, dragVec);
        const abs = [Math.abs(rotAxisRaw.x), Math.abs(rotAxisRaw.y), Math.abs(rotAxisRaw.z)];
        const idx = abs.indexOf(Math.max(abs[0], abs[1], abs[2]));
        const axisNames = ['x','y','z'];
        const axis = axisNames[idx];
        const sign = Math.sign(rotAxisRaw.getComponent(idx)) || 1;
        const layer = dragStartCubie.userData.gridPos[axis];

        dragMode = 'executing';
        rotateLayer(axis, layer, sign).then(() => { dragMode = null; });
      }
    }
  }

  /**
   * camDir·camUp이 나타내는 현재 카메라 자세를, 표준 기준 벡터 (0,0,1)/(0,1,0)에서
   * 출발하는 쿼터니언 하나로 만든다. right = cross(up, dir) 이 되도록 구성해서
   * currentRightAxis()의 정의와 일치시킨다.
   */
  function basisQuaternion(dir, up){
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const trueUp = new THREE.Vector3().crossVectors(dir, right).normalize();
    const m = new THREE.Matrix4().makeBasis(right, trueUp, dir);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  /**
   * 큐브 면을 정확히 정면으로 바라보도록 카메라를 스냅한다.
   * - camDir은 6개의 월드축 중 가장 가까운 축으로
   * - camUp은 그 축을 기준으로 90도 간격인 4개의 후보 중 현재 camUp과 가장 가까운 것으로
   * 골라서, 필요한 최소한의 회전만 큐터니언 슬러프(slerp)로 부드럽게 적용한다.
   * (예전 버전은 up 벡터를 항상 월드 (0,1,0)으로 강제 리셋해서, 드래그를 놓을 때
   *  가끔 예상치 못한 큰 회전이 튀는 버그가 있었다.)
   */
  function snapCameraToNearestAxis(){
    if(cameraAnimating) return;

    const axisCandidates = [
      new THREE.Vector3(1,0,0), new THREE.Vector3(-1,0,0),
      new THREE.Vector3(0,1,0), new THREE.Vector3(0,-1,0),
      new THREE.Vector3(0,0,1), new THREE.Vector3(0,0,-1)
    ];

    let targetDir = axisCandidates[0], bestDirDot = -Infinity;
    for(const a of axisCandidates){
      const d = camDir.dot(a);
      if(d > bestDirDot){ bestDirDot = d; targetDir = a; }
    }

    const upRef = Math.abs(targetDir.y) > 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(0,1,0);
    const baseUp = upRef.clone().addScaledVector(targetDir, -upRef.dot(targetDir)).normalize();

    let targetUp = baseUp, bestUpDot = -Infinity;
    for(let i=0;i<4;i++){
      const cand = baseUp.clone().applyAxisAngle(targetDir, i * Math.PI/2);
      const d = cand.dot(camUp);
      if(d > bestUpDot){ bestUpDot = d; targetUp = cand; }
    }

    cameraAnimating = true;
    const startQuat = basisQuaternion(camDir, camUp);
    const endQuat = basisQuaternion(targetDir, targetUp);
    const refDir = new THREE.Vector3(0,0,1);
    const refUp = new THREE.Vector3(0,1,0);
    const t0 = performance.now();
    const duration = 200;

    function frame(now){
      const t = Math.min((now - t0) / duration, 1);
      const q = startQuat.clone().slerp(endQuat, easeInOutQuad(t));
      camDir.copy(refDir).applyQuaternion(q);
      camUp.copy(refUp).applyQuaternion(q);
      updateCameraPosition();
      if(t < 1){
        requestAnimationFrame(frame);
      } else {
        camDir.copy(targetDir);
        camUp.copy(targetUp);
        orthonormalizeCamera();
        updateCameraPosition();
        cameraAnimating = false;
      }
    }
    requestAnimationFrame(frame);
  }

  function onPointerUp(){
    if(dragMode === 'camera'){
      snapCameraToNearestAxis();
    }
    if(dragMode === 'camera' || dragMode === 'pending-layer') dragMode = null;
    wrap.classList.remove('grabbing');
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  renderer.domElement.addEventListener('wheel', (e) => {
    radius = clamp(radius + e.deltaY * 0.006, radiusBounds.min, radiusBounds.max);
    updateCameraPosition();
    e.preventDefault();
  }, { passive:false });

  // ---- 모바일 두 손가락 핀치 줌 ----
  let pinchStartDist = null;
  let pinchStartRadius = null;
  let activeTouchCount = 0;

  function touchDistance(touches){
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  wrap.addEventListener('touchstart', (e) => {
    activeTouchCount = e.touches.length;
    if(e.touches.length === 2){
      // 손가락이 두 개가 되는 순간, 진행 중이던 한 손가락 드래그(층 회전/시점 회전)는 취소한다
      dragMode = null;
      pinchStartDist = touchDistance(e.touches);
      pinchStartRadius = radius;
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if(e.touches.length === 2 && pinchStartDist){
      const dist = touchDistance(e.touches);
      const scale = pinchStartDist / dist;
      radius = clamp(pinchStartRadius * scale, radiusBounds.min, radiusBounds.max);
      updateCameraPosition();
      e.preventDefault();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    activeTouchCount = e.touches.length;
    if(e.touches.length < 2){
      pinchStartDist = null;
      pinchStartRadius = null;
    }
  });
  wrap.addEventListener('touchcancel', (e) => {
    activeTouchCount = e.touches.length;
    pinchStartDist = null;
    pinchStartRadius = null;
  });

  window.addEventListener('keydown', (e) => {
    if(e.repeat) return;
    if(e.key === 'Escape'){
      e.preventDefault();
      togglePause();
      return;
    }
    if(isPaused || !gameStarted) return;
    if(e.code === 'Space'){
      e.preventDefault();
      rollView(e.shiftKey ? -1 : 1);
      return;
    }
    const key = e.key.toLowerCase();
    if(key === 'w') orbitUp(1);
    else if(key === 's') orbitUp(-1);
    else if(key === 'd') orbitSide(1);
    else if(key === 'a') orbitSide(-1);
  });

  let moveCount = 0;
  let timerRunning = false, timerStart = 0, timerElapsed = 0, timerInterval = null;

  function updateHUD(){
    document.getElementById('moves-value').textContent = String(moveCount);
    const el = document.querySelector('.readout.moves');
    el.classList.remove('pulse');
    void el.offsetWidth; // 리플로우를 강제해서 애니메이션을 다시 재생시킴
    el.classList.add('pulse');
  }

  function updateUndoButton(){
    document.getElementById('undo-btn').disabled = (moveHistory.length === 0) || animating || isPaused;
  }

  function formatTime(ms){
    const totalSec = ms / 1000;
    const m = Math.floor(totalSec / 60);
    const s = totalSec - m * 60;
    return String(m).padStart(2,'0') + ':' + s.toFixed(1).padStart(4,'0');
  }

  function updateTimerDisplay(){
    document.getElementById('timer-value').textContent = formatTime(timerElapsed);
  }

  function startTimerIfNeeded(){
    if(!timerRunning && !solvedState && !isPaused){
      timerRunning = true;
      timerStart = performance.now() - timerElapsed;
      timerInterval = setInterval(() => {
        timerElapsed = performance.now() - timerStart;
        updateTimerDisplay();
      }, 100);
    }
  }
  function stopTimer(){
    timerRunning = false;
    clearInterval(timerInterval);
  }
  function resetTimer(){
    stopTimer();
    timerElapsed = 0;
    updateTimerDisplay();
  }

  async function scrambleCube(){
    if(animating) return;
    gameStarted = true;
    closeMenu();
    isPaused = false;
    document.getElementById('win-overlay').classList.remove('show');
    document.getElementById('scramble-btn').disabled = true;
    document.getElementById('reset-btn').disabled = true;
    document.getElementById('undo-btn').disabled = true;
    resetTimer();
    solvedState = false;
    moveHistory = [];

    const axes = ['x','y','z'];
    const layers = [-1,0,1];
    let lastAxis = null, lastLayer = null;
    for(let i=0;i<SCRAMBLE_MOVES;i++){
      let axis, layer;
      do{
        axis = axes[Math.floor(Math.random()*3)];
        layer = layers[Math.floor(Math.random()*3)];
      } while(axis === lastAxis && layer === lastLayer);
      lastAxis = axis; lastLayer = layer;
      const dir = Math.random() < 0.5 ? 1 : -1;
      await rotateLayer(axis, layer, dir, { silent:true, duration: SCRAMBLE_DURATION });
    }

    moveCount = 0;
    document.getElementById('moves-value').textContent = '0';
    document.getElementById('scramble-btn').disabled = false;
    document.getElementById('reset-btn').disabled = false;
    updateUndoButton();
  }

  function resetCube(){
    if(animating) return;
    buildCube();
    moveCount = 0;
    solvedState = false;
    moveHistory = [];
    document.getElementById('moves-value').textContent = '0';
    resetTimer();
    document.getElementById('win-overlay').classList.remove('show');
    updateUndoButton();
  }

  async function undoMove(){
    if(animating || isPaused || moveHistory.length === 0) return;
    const last = moveHistory.pop();
    updateUndoButton();
    await rotateLayer(last.axis, last.layer, -last.dir, { duration: MOVE_DURATION, isUndo: true });
    moveCount = Math.max(0, moveCount - 1);
    document.getElementById('moves-value').textContent = String(moveCount);
    if(solvedState){
      solvedState = false;
      document.getElementById('win-overlay').classList.remove('show');
      startTimerIfNeeded();
    }
    updateUndoButton();
  }

  function updatePauseButton(){
    const btn = document.getElementById('pause-btn');
    const svg = btn.querySelector('svg');
    if(isPaused){
      svg.innerHTML = '<path d="M7 4v16l14-8z" fill="currentColor" stroke="none"/>';
      btn.title = '계속하기';
    } else {
      svg.innerHTML = '<line x1="8" y1="4" x2="8" y2="20"/><line x1="16" y1="4" x2="16" y2="20"/>';
      btn.title = '일시정지';
    }
  }

  function togglePause(){
    if(!gameStarted) return;
    // 타임어택에서 완성 팝업이 떠 있는 동안에는 일시정지 메뉴를 겹쳐 띄우지 않는다
    if(currentMode === 'timeattack' && solvedState) return;

    isPaused = !isPaused;
    document.getElementById('scramble-btn').disabled = isPaused;
    document.getElementById('reset-btn').disabled = isPaused;
    updateUndoButton();
    updatePauseButton();
    if(isPaused){
      stopTimer();
      openMenu('pause');
    } else {
      closeMenu();
      startTimerIfNeeded();
    }
  }

  function openMenu(context){
    const titleEl = document.getElementById('menu-title');
    const subEl = document.getElementById('menu-sub');
    const primaryBtn = document.getElementById('menu-primary-btn');
    if(context === 'pause'){
      titleEl.textContent = '일시정지';
      subEl.textContent = '이어서 플레이하거나 설정을 바꿔보세요';
      primaryBtn.textContent = '계속하기';
    } else {
      titleEl.textContent = 'CUBEX';
      subEl.textContent = '모드를 고르고 시작하세요';
      primaryBtn.textContent = '게임 시작';
    }
    document.getElementById('menu-overlay').dataset.context = context;
    document.getElementById('menu-overlay').classList.add('show');
  }

  function closeMenu(){
    document.getElementById('menu-overlay').classList.remove('show');
  }

  function setMode(mode){
    currentMode = mode;
    document.body.classList.toggle('mode-timeattack', mode === 'timeattack');
    document.body.classList.toggle('mode-play', mode === 'play');
    document.getElementById('mode-play-btn').classList.toggle('active', mode === 'play');
    document.getElementById('mode-timeattack-btn').classList.toggle('active', mode === 'timeattack');
    scrambleCube();
  }

  let helpVisible = false;
  function toggleHelp(){
    helpVisible = !helpVisible;
    document.body.classList.toggle('show-help', helpVisible);
    document.getElementById('help-btn').classList.toggle('active', helpVisible);
  }

  document.getElementById('scramble-btn').addEventListener('click', scrambleCube);
  document.getElementById('reset-btn').addEventListener('click', resetCube);
  document.getElementById('undo-btn').addEventListener('click', undoMove);
  document.getElementById('pause-btn').addEventListener('click', togglePause);
  document.getElementById('mode-play-btn').addEventListener('click', () => setMode('play'));
  document.getElementById('mode-timeattack-btn').addEventListener('click', () => setMode('timeattack'));
  document.getElementById('roll-ccw-btn').addEventListener('click', () => { if(gameStarted && !isPaused) rollView(-1); });
  document.getElementById('roll-cw-btn').addEventListener('click', () => { if(gameStarted && !isPaused) rollView(1); });
  document.getElementById('help-btn').addEventListener('click', toggleHelp);
  document.getElementById('menu-primary-btn').addEventListener('click', () => {
    const ctx = document.getElementById('menu-overlay').dataset.context;
    if(ctx === 'pause'){
      togglePause(); // isPaused가 true인 상태이므로 이어하기로 동작한다
    } else {
      scrambleCube(); // 처음 시작 (닫기 + 셔플까지 scrambleCube 안에서 처리)
    }
  });
  document.getElementById('menu-settings-btn').addEventListener('click', () => {
    document.getElementById('menu-settings').classList.toggle('open');
  });
  document.getElementById('win-again-btn').addEventListener('click', () => {
    document.getElementById('win-overlay').classList.remove('show');
    scrambleCube();
  });

  function loop(){
    requestAnimationFrame(loop);
    renderer.render(scene, camera);
  }
  loop();

  document.getElementById('moves-value').textContent = '0';
  updateTimerDisplay();
  openMenu('start'); // 처음엔 자동으로 섞지 않고, "게임 시작"을 누를 때까지 시작 메뉴를 보여준다
})();