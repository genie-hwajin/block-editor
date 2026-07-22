/* ********************************************************************************
 * Copyright: SELab.AI (c) 2026
 ********************************************************************************/
// ELK layout adapter for SysML Editor webview
// Exposes SELAB.applyElkLayout(diagramData, options?) and falls back gracefully.
(function() {
  const NS = (window.SELAB = window.SELAB || {});

  // 레이아웃 품질 지표(노드 겹침/엣지 교차/캔버스 밀도/엣지 종단 명확성) 콘솔 로깅 스위치.
  // 과제의 8개 품질 기준을 개발 중 수치로 검증하기 위해 추가한 로직으로, 코드는 남겨두되
  // 평소 사용 시 콘솔에 로그가 쌓이지 않도록 기본값은 false. 필요 시 true로 바꿔서 확인 가능.
  const DEBUG_LAYOUT_METRICS = false;

  /**
   * Apply ELK (Eclipse Layout Kernel) layout to the given in-memory diagram data.
   * diagramData: { elements: [{id, name, width, height, x, y}], connections: [{id, source, target}] }
   * options: optional ELK layout options
   */
  NS.applyElkLayout = async function(diagramData, options = {}) {
    try {
      if (!diagramData || !Array.isArray(diagramData.elements)) return;
      const ELKCtor = window.ELK;
      if (typeof ELKCtor !== 'function') {
        console.log('[applyElkLayout] ELK not available, using fallback grid');
        fallbackGrid(diagramData);
        return;
      }

      // displaySettings에서 ELK 설정 참조
      const DS = window.SELAB?.Editor?.config?.displaySettings;
      const ELK_CFG = DS?.elk;
  

      const elk = new ELKCtor();
      const nodeById = new Map();
      const idByName = new Map();
      for (const n of diagramData.elements) {
        nodeById.set(n.id, n);
        idByName.set(n.name, n.id);
      }

      function isHierarchicalEdgeKind(kind) {
        if (!kind) return false;
        const k = String(kind).toLowerCase();
        // [SELab.AI] composition/shared는 독립 노드로 렌더링하므로 계층 관계가 아님
        if (k === 'composition' || k.includes('composition') || k === 'shared') {
          return false;
        }
        if (k.includes('inheritance') || k.includes('specialization') || k.includes('generalization')) {
            return false;
        }
        return (
          k.includes('contain') ||
          k.includes('own') ||
          k.includes('aggregate') ||
          k.includes('nest') ||
          k.includes('member') ||
          k.includes('usage') ||
          k.includes('perform') ||
          k.includes('include') ||
          k.includes('has') ||
          k.includes('annotation')  // metadata about 구문의 annotation edge 제외
        );
      }

      const finalLayoutOptions = Object.assign({
          'elk.algorithm': ELK_CFG?.algorithm ?? 'layered',
          'elk.direction': ELK_CFG?.direction ?? 'DOWN',
          'elk.spacing.nodeNode': String(ELK_CFG?.nodeNodeSpacing ?? 80),
          'elk.layered.spacing.nodeNodeBetweenLayers': String(ELK_CFG?.nodeNodeBetweenLayers ?? 80),
          'elk.spacing.componentComponent': String(ELK_CFG?.componentComponentSpacing ?? 80),
          'elk.layered.spacing.edgeNodeBetweenLayers': String(ELK_CFG?.edgeNodeBetweenLayers ?? 40),
          'elk.spacing.edgeNode': String(ELK_CFG?.edgeNodeSpacing ?? 40),
          'elk.layered.considerModelOrder.strategy': ELK_CFG?.modelOrderStrategy ?? 'NODES_AND_EDGES',
          'elk.layered.nodePlacement.strategy': ELK_CFG?.nodePlacement ?? 'NETWORK_SIMPLEX',
          'elk.edgeRouting': ELK_CFG?.edgeRouting ?? 'ORTHOGONAL',
          'elk.spacing.edgeEdge': String(ELK_CFG?.edgeEdgeSpacing ?? 15),
          'elk.spacing.edgeEdgeBetweenLayers': String(ELK_CFG?.edgeEdgeBetweenLayers ?? 15),
          'elk.layered.mergeEdges': String(ELK_CFG?.mergeEdges ?? false),
          'elk.layered.mergeHierarchyEdges': String(ELK_CFG?.mergeHierarchyEdges ?? false),
          'elk.layered.crossingMinimization.strategy': ELK_CFG?.crossingMinimization ?? 'LAYER_SWEEP',
          'elk.layered.compaction.postCompaction.strategy': ELK_CFG?.compactionStrategy ?? 'EDGE_LENGTH',
          'elk.layered.compaction.connectedComponents': String(ELK_CFG?.compactConnectedComponents ?? true),
          'elk.layered.thoroughness': String(ELK_CFG?.thoroughness ?? 7),
          'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN'
        }, options || {});

      // Fork 병렬 분기 감지: fork 후속 노드 간 flow 엣지는 ELK 레이어 제약에서 제외
      const forkSuccessors = new Map();
      {
        const allConns = Array.isArray(diagramData.connections) ? diagramData.connections : [];
        for (const e of allConns) {
          const kind = String(e.kind || e.type || '').toLowerCase();
          if (!kind.includes('succession') && !kind.includes('then') && !kind.includes('transition')) continue;
          const s = resolveIdDirect(e.source);
          if (!s) continue;
          const sNode = nodeById.get(s);
          const sKind = String(sNode?.kind || sNode?.type || '').toLowerCase();
          if (!sKind.includes('fork')) continue;
          const t = resolveIdDirect(e.target);
          if (!t) continue;
          if (!forkSuccessors.has(s)) forkSuccessors.set(s, new Set());
          forkSuccessors.get(s).add(t);
        }
      }

      function areForkSiblings(id1, id2) {
        for (const [, successors] of forkSuccessors) {
          if (successors.has(id1) && successors.has(id2)) return true;
        }
        return false;
      }

      // composition 엣지의 타겟 노드 수집 (featuretyping 필터링에서 사용)
      const compositionTargets = new Set();
      {
        const allConns = Array.isArray(diagramData.connections) ? diagramData.connections : [];
        for (const e of allConns) {
          const kind = String(e.kind || e.type || '').toLowerCase();
          if (kind === 'composition' || kind.includes('composition') || kind === 'shared') {
            const t = e.target;
            if (t && nodeById.has(t)) {
              compositionTargets.add(t);
            } else if (t && idByName.has(t)) {
              compositionTargets.add(idByName.get(t));
            }
          }
        }
      }

      // 엣지 수집
      const allElkEdges = (() => {
        const all = Array.isArray(diagramData.connections) ? diagramData.connections : [];
        const kept = [];
        const seenPairs = new Set();

        // 1차: 기존 엣지 처리 (직접 해석만, 부모 폴백 없음)
        for (const e of all) {
          const kind = e.kind || e.type;
          if (isHierarchicalEdgeKind(kind) && !e.kindClass) {
            continue;
          }
          let s = resolveIdDirect(e.source);
          let t = resolveIdDirect(e.target);
          // border node(port) → 부모 노드 해석 (featuretyping 에지 라우팅 지원)
          const kindLower = String(kind || '').toLowerCase();
          if (kindLower === 'featuretyping') {
            if (!s) s = resolveId(e.source);
            if (!t) t = resolveId(e.target);
          }
          if (!s || !t || s === t) {
            continue;
          }
          // [FIX] 예전에는 컨테이너를 가로지르는 featuretyping 엣지를 ELK에서 제외하고
          // mxGraph 자동 라우팅에 떠넘겼음(엣지가 아예 안 그려지는 원인이었음).
          // 지금은 elk.hierarchyHandling=INCLUDE_CHILDREN이 정상 동작하므로
          // ELK가 계층을 가로지르는 엣지도 직접 라우팅할 수 있어 이 예외 처리가 더는 필요 없음.
          const pairKey = `${s}__${t}`;
          seenPairs.add(pairKey);
          kept.push({ id: e.id || pairKey, sources: [s], targets: [t] });
        }

        // 2차: flow 엣지의 border node → 부모 노드 해석 (같은 컨테이너 내부만)
        for (const e of all) {
          const kind = String(e.kind || e.type || '').toLowerCase();
          if (!kind.includes('flow')) continue;
          const s = resolveId(e.source);
          const t = resolveId(e.target);
          if (!s || !t || s === t) continue;
          // fork 병렬 분기 간 flow 엣지는 레이어 제약에서 제외
          if (areForkSiblings(s, t)) continue;
          const pairKey = `${s}__${t}`;
          if (seenPairs.has(pairKey)) continue;
          const sNode = nodeById.get(s);
          const tNode = nodeById.get(t);
          if (!sNode || !tNode) continue;
          if (!sNode.parent || !tNode.parent || sNode.parent !== tNode.parent) continue;
          seenPairs.add(pairKey);
          kept.push({ id: e.id || `flow_${pairKey}`, sources: [s], targets: [t] });
        }

        // 3차: body 타겟 → succession 타겟 가상 엣지 추가 (레이어 분리용)
        const bodyTgts = new Map();
        const succTgts = new Map();
        for (const e of all) {
          const kind = String(e.kind || e.type || '').toLowerCase();
          const s = resolveIdDirect(e.source);
          const t = resolveIdDirect(e.target);
          if (!s || !t || s === t) continue;
          if (kind === 'body') {
            if (!bodyTgts.has(s)) bodyTgts.set(s, []);
            bodyTgts.get(s).push(t);
          }
          if (kind.includes('succession') || kind.includes('then') || kind.includes('transition')) {
            if (!succTgts.has(s)) succTgts.set(s, []);
            succTgts.get(s).push(t);
          }
        }
        for (const [src, bts] of bodyTgts) {
          const sts = succTgts.get(src) || [];
          for (const bt of bts) {
            for (const st of sts) {
              if (bt === st) continue;
              const pairKey = `${bt}__${st}`;
              if (seenPairs.has(pairKey)) continue;
              seenPairs.add(pairKey);
              kept.push({ id: `_implicit_${pairKey}`, sources: [bt], targets: [st] });
            }
          }
        }

        return kept;
      })();

      // 부모 관계 맵 구축 (LCA 기반 엣지 배분용)
      const parentOf = new Map();
      for (const n of diagramData.elements) {
        if (n.parent) {
          const pid = nodeById.has(n.parent) ? n.parent : (idByName.get(n.parent) || null);
          if (pid && nodeById.has(pid)) parentOf.set(n.id, pid);
        }
      }

      // LCA 기반 엣지 배분: 같은 컨테이너 내 엣지는 해당 컨테이너 레벨에 배치
      function getAncestorChain(nid) {
        const chain = [];
        let cur = nid;
        while (cur) {
          chain.push(cur);
          cur = parentOf.get(cur) || null;
        }
        chain.push('root');
        return chain;
      }

      function findEdgeLCA(id1, id2) {
        const chain1 = getAncestorChain(id1);
        const set2 = new Set(getAncestorChain(id2));
        for (const a of chain1) {
          if (set2.has(a)) return a;
        }
        return 'root';
      }

      const edgesByContainer = new Map();
      edgesByContainer.set('root', []);
      for (const edge of allElkEdges) {
        const lca = findEdgeLCA(edge.sources[0], edge.targets[0]);
        if (!edgesByContainer.has(lca)) edgesByContainer.set(lca, []);
        edgesByContainer.get(lca).push(edge);
      }

      // 컨테이너 노드에 엣지 부착
      function attachEdgesToHierarchy(node) {
        const containerEdges = edgesByContainer.get(node.id);
        if (containerEdges && containerEdges.length > 0) {
          node.edges = containerEdges;
        }
        if (node.children) {
          for (const child of node.children) attachEdgesToHierarchy(child);
        }
      }

      const elkChildren = buildHierarchy(diagramData.elements);
      const elkGraph = {
        id: 'root',
        layoutOptions: finalLayoutOptions,
        children: elkChildren,
        edges: edgesByContainer.get('root') || [],
      };
      for (const child of elkGraph.children) attachEdgesToHierarchy(child);

      // 직접 해석만 (부모 폴백 없음) - 메인 엣지 루프용
      function resolveIdDirect(ref) {
        if (!ref) return null;
        if (nodeById.has(ref)) return ref;
        return idByName.get(ref) || null;
      }

      // 부모 폴백 포함 - flow 엣지 및 computeRanks용
      function resolveId(ref) {
        if (!ref) return null;
        if (nodeById.has(ref)) return ref;
        const byNameResult = idByName.get(ref);
        if (byNameResult) return byNameResult;
        // Border node/port → 부모 노드로 해석 (data flow 엣지 레이어링 지원)
        let current = String(ref);
        while (true) {
          const sepIdx = current.lastIndexOf('::');
          if (sepIdx <= 0) break;
          current = current.substring(0, sepIdx);
          if (nodeById.has(current)) return current;
          const parentByName = idByName.get(current);
          if (parentByName) return parentByName;
        }
        return null;
      }

      // Build compound hierarchy for ELK using explicit parent or qualified name ("::") inference.
      function buildHierarchy(nodes) {
        const byId = new Map(nodes.map(n => [n.id, n]));
        const byName = new Map(nodes.map(n => [n.name, n]));
        const parentIdOf = new Map(); // childId -> parentId

        function findQualifiedParentId(el) {
          if (!el || !el.name) return null;
          const parts = String(el.name).split('::');
          if (parts.length <= 1) return null;
          // try longest prefix first
          for (let i = parts.length - 1; i > 0; i--) {
            const prefix = parts.slice(0, i).join('::');
            const p = byName.get(prefix);
            if (p) return p.id;
          }
          return null;
        }

        // Assign parents: prefer explicit element.parent (id or name), else infer from qualified name
        for (const n of nodes) {
          const nodeType = String(n.type || '').toLowerCase();
          let pid = null;
          if (n.parent) {
            pid = byId.has(n.parent) ? n.parent : (byName.get(String(n.parent))?.id || null);
          }
          // composition target은 hierarchy.js에서 Package 레벨로 설정됨 → qualified name fallback 건너뜀
          if (!pid && !compositionTargets.has(n.id)) {
            pid = findQualifiedParentId(n);
          }
          // composition 타겟 노드는 hierarchy.js에서 이미 Package 레벨로 승격됨
          // buildHierarchy에서 추가 승격 불필요
          if (pid && pid !== n.id && byId.has(pid)) {
            parentIdOf.set(n.id, pid);
          }
        }

        // Build children lists
        const childrenOf = new Map(); // parentId -> childIds[]
        for (const n of nodes) {
          const pid = parentIdOf.get(n.id) || 'root';
          if (!childrenOf.has(pid)) childrenOf.set(pid, []);
          childrenOf.get(pid).push(n.id);
        }

        function roleWeight(n) {
          const r = String(n.role || '').toLowerCase();
          const t = String(n.type || '').toLowerCase();
          if (r === 'initial' || t === 'startaction') return -1;
          if (r === 'fork') return 0;
          // ElseIfAction/ElseAction은 then ActionUsage보다 뒤에 배치
          if (t === 'elseifaction') return 1.5;
          if (t === 'elseaction') return 1.8;
          if (t.includes('action') && !t.includes('definition')) return 1;
          if (r === 'join') return 2;
          if (r === 'final') return 3;
          return 2;
        }

        // Compute topological ranks within a container using in-container controlflow edges
        function computeRanks(parentId) {
          const childIds = new Set(childrenOf.get(parentId) || []);
          const indeg = new Map();
          const adj = new Map();
          // init
          for (const cid of childIds) { indeg.set(cid, 0); adj.set(cid, []); }
          // collect edges inside this container
          const allConns = Array.isArray(diagramData.connections) ? diagramData.connections : [];
          // body 엣지의 소스→타겟 매핑 (암시적 순서 생성용)
          const bodyTargetsBySource = new Map();
          const successionTargetsBySource = new Map();
          for (const e of allConns) {
            const kind = String(e.kind || e.type || '').toLowerCase();
            const s = resolveId(e.source);
            const t = resolveId(e.target);
            if (!s || !t || s === t || !childIds.has(s) || !childIds.has(t)) continue;
            if (kind === 'body') {
              if (!bodyTargetsBySource.has(s)) bodyTargetsBySource.set(s, []);
              bodyTargetsBySource.get(s).push(t);
            }
            if (kind.includes('succession') || kind.includes('then') || kind.includes('transition')) {
              if (!successionTargetsBySource.has(s)) successionTargetsBySource.set(s, []);
              successionTargetsBySource.get(s).push(t);
            }
            if (!(kind.includes('control') || kind.includes('flow') || kind.includes('succession') || kind.includes('then') || kind.includes('transition') || kind === 'body' || kind === 'composition' || kind === 'shared' || kind === 'featuretyping')) continue;
            // fork 병렬 분기 간 flow 엣지는 순서 제약에서 제외
            if (kind.includes('flow') && areForkSiblings(s, t)) continue;
            adj.get(s).push(t);
            indeg.set(t, (indeg.get(t) || 0) + 1);
          }
          // body 타겟 → succession 타겟 암시적 순서 추가
          // (loop body는 loop 종료 후 실행되는 노드보다 먼저 배치)
          for (const [src, bodyTargets] of bodyTargetsBySource) {
            const succTargets = successionTargetsBySource.get(src) || [];
            for (const bt of bodyTargets) {
              for (const st of succTargets) {
                if (bt !== st && childIds.has(bt) && childIds.has(st)) {
                  adj.get(bt).push(st);
                  indeg.set(st, (indeg.get(st) || 0) + 1);
                }
              }
            }
          }
          // Kahn's algorithm to assign ranks (longest distance from sources)
          const rank = new Map();
          const q = [];
          for (const cid of childIds) {
            if ((indeg.get(cid) || 0) === 0) { q.push(cid); rank.set(cid, 0); }
          }
          while (q.length > 0) {
            const u = q.shift();
            const ru = rank.get(u) || 0;
            for (const v of (adj.get(u) || [])) {
              const newRank = Math.max(ru + 1, rank.get(v) || 0);
              rank.set(v, newRank);
              indeg.set(v, (indeg.get(v) || 0) - 1);
              if ((indeg.get(v) || 0) === 0) q.push(v);
            }
          }

          // 사이클 처리: ranked 노드에서 BFS로 unranked 후속 노드에 rank 전파
          const propagateQ = [];
          for (const cid of childIds) {
            if (rank.has(cid)) propagateQ.push(cid);
          }
          while (propagateQ.length > 0) {
            const u = propagateQ.shift();
            const ru = rank.get(u) || 0;
            for (const v of (adj.get(u) || [])) {
              if (!rank.has(v)) {
                rank.set(v, ru + 1);
                propagateQ.push(v);
              }
            }
          }

          return rank;
        }

        function toElkChildren(parentId) {
          const childIds = (childrenOf.get(parentId) || []).slice();
          const ranks = computeRanks(parentId);
          childIds.sort((a, b) => {
            const na = byId.get(a) || {}; const nb = byId.get(b) || {};
            // import된 패키지는 뒤로 (현재 패키지가 위, import 패키지가 아래)
            const ia = na.isImported ? 1 : 0;
            const ib = nb.isImported ? 1 : 0;
            if (ia !== ib) return ia - ib;
            const ra = ranks.has(a) ? ranks.get(a) : 0;
            const rb = ranks.has(b) ? ranks.get(b) : 0;
            if (ra !== rb) return ra - rb;
            const wa = roleWeight(na); const wb = roleWeight(nb);
            if (wa !== wb) return wa - wb;
            const an = String(na.name || ''); const bn = String(nb.name || '');
            return an.localeCompare(bn);
          });

          // 부모가 IfAction인지 확인 (partitioning 적용 대상)
          const parentNode = byId.get(parentId);
          const parentTypeLower = String(parentNode?.type || '').toLowerCase();
          const parentIsIfAction = parentTypeLower.includes('ifaction');

          const elkChildren = childIds.map((cid) => {
            const n = byId.get(cid);
            // collapsed 상태이면 자식 무시하고 leaf 노드로 처리
            const hasKids = childrenOf.has(n.id) && !n._collapsed;
            if (hasKids) {
              const typeLower = String(n.type || '').toLowerCase();
              const isIfAction = typeLower.includes('ifaction') || typeLower === 'elseifaction' || typeLower === 'elseaction';
              const isWhileLoop = typeLower.includes('whileloop');
              
              // IfActionUsage needs more top padding for condition label and branch labels (then/else)
              const CP = ELK_CFG?.containerPadding;
              const basePaddingTop = isIfAction ? (CP?.ifActionTop ?? 90) : (CP?.top ?? 10);
              // precomputeNodeSizes에서 계산한 compartment 높이를 basePaddingTop에 가산
              const paddingTop = basePaddingTop + (n._precomputedPaddingTop || 0);
              
              // WhileLoopActionUsage needs more bottom padding for 'until condition' label
              const paddingBottom = isWhileLoop ? (CP?.whileLoopBottom ?? 70) : (CP?.bottom ?? 10);

              // 컨테이너 내부: containerChildSpacing으로 actor 등 엣지 없는 자식 노드 간 세로 간격 제어
              // (별도 connected component로 처리되므로 componentComponentSpacing 사용)
              const childSpacing = String(ELK_CFG?.containerChildSpacing ?? 40);
              // actionFlow compartment가 있는 컨테이너는 spacing 축소
              const hasActionFlow = Array.isArray(n.compartments) &&
                n.compartments.some(c => c.key === 'actionFlow');
              const AF = ELK_CFG?.actionFlow;
              const betweenLayers = hasActionFlow
                ? String(AF?.nodeNodeBetweenLayers ?? 50)
                : String(ELK_CFG?.nodeNodeBetweenLayers ?? 80);
              const edgeNodeBL = hasActionFlow
                ? String(AF?.edgeNodeBetweenLayers ?? 20)
                : String(ELK_CFG?.edgeNodeBetweenLayers ?? 40);
              const edgeNodeSp = hasActionFlow
                ? String(AF?.edgeNodeSpacing ?? 20)
                : String(ELK_CFG?.edgeNodeSpacing ?? 40);

              const containerLayoutOpts = {
                  'elk.padding': `top=${paddingTop},left=${CP?.left ?? 10},right=${CP?.right ?? 10},bottom=${paddingBottom}`,
                  'elk.spacing.nodeNode': String(ELK_CFG?.nodeNodeSpacing ?? 80),
                  'elk.layered.spacing.nodeNodeBetweenLayers': betweenLayers,
                  'elk.spacing.componentComponent': childSpacing,
                  'elk.layered.spacing.edgeNodeBetweenLayers': edgeNodeBL,
                  'elk.spacing.edgeNode': edgeNodeSp,
                  'elk.edgeRouting': ELK_CFG?.edgeRouting ?? 'ORTHOGONAL',
                  // [FIX] 'elk.layered.cycleBreaking.strategy'를 컨테이너마다 또 지정하면
                  // elk.hierarchyHandling=INCLUDE_CHILDREN 과 충돌하여 elkjs 0.11.1에서 내부 크래시가 발생함
                  // (root의 finalLayoutOptions에 이미 설정되어 있고 하위로 상속되므로 여기서는 생략)
                  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED'
              };

              const elkNodeChildren = toElkChildren(n.id);
              const elkNode = {
                id: n.id,
                labels: n.name ? [{ text: String(n.name) }] : undefined,
                layoutOptions: containerLayoutOpts,
                children: elkNodeChildren,
              };

              // IfAction 컨테이너: 자식 간 보이지 않는 순서 엣지로 세로 순서 강제
              if (isIfAction && elkNodeChildren.length > 1) {
                const orderEdges = [];
                for (let oi = 0; oi < elkNodeChildren.length - 1; oi++) {
                  orderEdges.push({
                    id: `__order_${elkNodeChildren[oi].id}_${elkNodeChildren[oi + 1].id}`,
                    sources: [elkNodeChildren[oi].id],
                    targets: [elkNodeChildren[oi + 1].id],
                  });
                }
                elkNode.edges = (elkNode.edges || []).concat(orderEdges);
              }

              return elkNode;
            } else {
              // [FIX] Start/Finalize nodes are rendered as small circles.
              // Force small size to prevent large gaps in edges.
              // ActionUsage 계열 타입만 이름으로 Start/Finalize 판별
              // item def Start 등은 제외 (ActionUsage, AcceptActionUsage, StartAction 등만 해당)
              const nameLower = String(n.name || '').toLowerCase();
              const kindLower = String(n.kind || '').toLowerCase();
              const isActionType = kindLower.includes('action') || kindLower === 'startaction' || kindLower === 'doneaction';
              
              if (isActionType && (nameLower === 'start' || nameLower === 'finalize')) {
                const SA = DS?.specialNode?.startAction;
                return {
                  id: n.id,
                  width: Number(n.width) || SA?.width || 28,
                  height: Number(n.height) || SA?.height || 28,
                  labels: n.name ? [{ text: String(n.name) }] : undefined,
                };
              }
              // DoneAction / FinalNode: 이중 원으로 렌더링되는 노드
              if (kindLower === 'doneaction' || kindLower === 'finalnode' ||
                  (isActionType && nameLower === 'done')) {
                const DA = DS?.specialNode?.doneAction;
                return {
                  id: n.id,
                  width: DA?.width ?? 34,
                  height: DA?.height ?? 34,
                  labels: n.name ? [{ text: String(n.name) }] : undefined,
                };
              }

              // collapsed 노드는 최소 크기로 강제 (precomputeNodeSizes 덮어쓰기 방지)
              if (n._collapsed) {
                return {
                  id: n.id,
                  width: 120,
                  height: 40,
                  labels: n.name ? [{ text: String(n.name) }] : undefined,
                };
              }

              // Compartment가 있는 노드는 precomputeNodeSizes에서 이미 계산됨
              // ELK는 그 값을 그대로 사용
              let w = Number(n.width || (DS?.nodePrecompute?.minWidth ?? 120));
              let h = Number(n.height || 60);
              
              // ELK의 자체 계산은 사용하지 않음 (precomputeNodeSizes가 더 정확함)
              if (false && n.compartments && Array.isArray(n.compartments)) {
                // 실제 mxGraph 렌더링에 맞춘 상수
                const LABEL_LINE_HEIGHT = 16;
                const LABEL_PADDING_VERTICAL = 20;
                const COMPARTMENT_HEADER_HEIGHT = 18;
                const COMPARTMENT_ITEM_HEIGHT = 16;
                const COMPARTMENT_MARGIN = 6;
                const PADDING_X = 16; // 좌우 패딩 (8px * 2)
                const DOC_INDENT = 8; // doc compartment 들여쓰기
                
                // Canvas를 사용한 실제 텍스트 너비 측정
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                ctx.font = '11px Arial'; // mxGraph 기본 폰트
                
                function measureTextWidth(text) {
                  return ctx.measureText(text).width;
                }
                
                // 텍스트 줄바꿈 계산 함수 (실제 텍스트 너비 기반)
                function calculateWrappedLines(text, maxTextWidth) {
                  if (!text) return 1;
                  const lines = String(text).split('\n');
                  let totalLines = 0;
                  
                  for (const line of lines) {
                    if (!line) {
                      totalLines += 1;
                      continue;
                    }
                    
                    // 실제 텍스트 너비 측정
                    const lineWidth = measureTextWidth(line);
                    
                    if (lineWidth <= maxTextWidth) {
                      totalLines += 1;
                    } else {
                      // 단어 단위로 줄바꿈 (공백과 콜론 기준)
                      const words = line.split(/[\s:]+/).filter(w => w);
                      let currentLine = '';
                      let wrappedLineCount = 1;
                      
                      for (let i = 0; i < words.length; i++) {
                        const word = words[i];
                        const testLine = currentLine ? currentLine + ' ' + word : word;
                        const testWidth = measureTextWidth(testLine);
                        
                        if (testWidth > maxTextWidth && currentLine) {
                          // 현재 줄이 너무 길면 다음 줄로
                          wrappedLineCount++;
                          currentLine = word;
                        } else {
                          currentLine = testLine;
                        }
                      }
                      
                      totalLines += wrappedLineCount;
                    }
                  }
                  
                  return totalLines;
                }
                
                // 1단계: 필요한 너비 결정
                let maxWidth = 200; // 기본 최소 너비
                
                for (const comp of n.compartments) {
                  const items = Array.isArray(comp.items) ? comp.items : [];
                  const isDoc = comp.key === 'doc';
                  
                  for (const item of items) {
                    let itemText = '';
                    if (typeof item === 'object') {
                      itemText = isDoc ? (item.body || '') : (item.name || item.id || '');
                    } else {
                      itemText = String(item);
                    }
                    
                    // 가장 긴 단어의 실제 너비 측정
                    const words = itemText.split(/\s+/);
                    let maxWordWidth = 0;
                    for (const word of words) {
                      const wordWidth = measureTextWidth(word);
                      maxWordWidth = Math.max(maxWordWidth, wordWidth);
                    }
                    
                    const minWidth = maxWordWidth + PADDING_X + (isDoc ? DOC_INDENT : 0);
                    maxWidth = Math.max(maxWidth, minWidth);
                  }
                }
                
                // 최대 너비 제한
                maxWidth = Math.min(maxWidth, 300);
                
                // 2단계: 확정된 너비로 높이 계산
                const labelText = String(n.name || '');
                
                // 라벨도 너비 기반 줄바꿈 계산
                const labelAvailableWidth = maxWidth - PADDING_X;
                const labelWrappedLines = calculateWrappedLines(labelText, labelAvailableWidth);
                let totalHeight = labelWrappedLines * LABEL_LINE_HEIGHT + LABEL_PADDING_VERTICAL;
                
                for (const comp of n.compartments) {
                  const items = Array.isArray(comp.items) ? comp.items : [];
                  if (items.length === 0) continue;
                  
                  totalHeight += COMPARTMENT_HEADER_HEIGHT;
                  
                  const isDoc = comp.key === 'doc';
                  const availableWidth = maxWidth - PADDING_X - (isDoc ? DOC_INDENT : 0);
                  
                  for (const item of items) {
                    let itemText = '';
                    if (typeof item === 'object') {
                      itemText = isDoc ? (item.body || '') : (item.name || item.id || '');
                    } else {
                      itemText = String(item);
                    }
                    
                    const wrappedLines = calculateWrappedLines(itemText, availableWidth);
                    const itemHeight = wrappedLines * COMPARTMENT_ITEM_HEIGHT;
                    totalHeight += itemHeight;
                  }
                  
                  totalHeight += COMPARTMENT_MARGIN;
                }
                
                totalHeight += COMPARTMENT_MARGIN;
                
                w = maxWidth;
                h = totalHeight;
              }

              const elkNode = {
                id: n.id,
                width: w,
                height: h,
                labels: n.name ? [{ text: String(n.name) }] : undefined,
              };

              return elkNode;
            }
          });

          return elkChildren;
        }

        return toElkChildren('root');
      }

      const result = await elk.layout(elkGraph);
      
      // Apply computed positions (and sizes) recursively to our diagramData
      // ELK 원본 상대 좌표(relativeX, relativeY)와 절대 좌표(x, y) 모두 저장
      // - mxGraph: relativeX, relativeY 사용 (부모 기준 상대 좌표)
      // - SVG: x, y 사용 (절대 좌표)
      function applyPositions(elkNode, offsetX, offsetY) {
        if (!elkNode || !Array.isArray(elkNode.children)) return;
        for (const child of elkNode.children) {
          const n = nodeById.get(child.id);
          const relX = Number(child.x || 0);
          const relY = Number(child.y || 0);
          const absX = Number(offsetX + relX);
          const absY = Number(offsetY + relY);
          if (n) {
            n.relativeX = relX;
            n.relativeY = relY;
            n.x = absX;
            n.y = absY;
            if (typeof child.width === 'number') n.width = Math.max(20, child.width);
            if (typeof child.height === 'number') n.height = Math.max(20, child.height);
          }
          if (Array.isArray(child.children)) {
            applyPositions(child, absX, absY);
          }
        }
      }
      applyPositions(result, 0, 0);

      // [DEBUG] 노드 겹침(overlap) 탐지 - 부모/자식 관계가 아닌 노드끼리 사각형이 겹치는지 확인
      if (DEBUG_LAYOUT_METRICS) {
        const isAncestor = (aId, bId) => {
          let cur = parentOf.get(bId);
          while (cur) {
            if (cur === aId) return true;
            cur = parentOf.get(cur);
          }
          return false;
        };
        const positioned = diagramData.elements.filter(n => typeof n.x === 'number' && typeof n.width === 'number');
        const overlaps = [];
        for (let i = 0; i < positioned.length; i++) {
          for (let j = i + 1; j < positioned.length; j++) {
            const a = positioned[i], b = positioned[j];
            if (isAncestor(a.id, b.id) || isAncestor(b.id, a.id)) continue; // 부모-자식 중첩은 정상이므로 제외
            const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
            const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
            if (overlapX > 1 && overlapY > 1) {
              overlaps.push({
                a: `${a.id} (${a.name})`,
                aParent: parentOf.get(a.id) || '(root)',
                b: `${b.id} (${b.name})`,
                bParent: parentOf.get(b.id) || '(root)',
                overlapX: Math.round(overlapX),
                overlapY: Math.round(overlapY),
              });
            }
          }
        }
        console.log(`[DEBUG elkLayout] 배치된 노드 수=${positioned.length}, 겹침 쌍 수=${overlaps.length}`);
        if (overlaps.length > 0) {
          console.log('[DEBUG elkLayout] 겹치는 노드 쌍 목록:', overlaps);
        }
      }

      /**
       * ELK 엣지 라우팅 결과를 diagramData.connections에 적용
       * @param {Object} elkNode - ELK 레이아웃 결과 노드
       * @param {number} offsetX - X 오프셋
       * @param {number} offsetY - Y 오프셋
       */
      function applyEdgeRouting(elkNode, offsetX, offsetY) {
        if (!elkNode) return;

        // 현재 레벨의 엣지 처리
        if (Array.isArray(elkNode.edges)) {
          for (const elkEdge of elkNode.edges) {
            const connection = diagramData.connections.find(c => c.id === elkEdge.id);
            if (!connection) continue;

            // ELK edge sections에서 경로 정보 추출
            if (elkEdge.sections && elkEdge.sections.length > 0) {
              const section = elkEdge.sections[0];
              const waypoints = [];

              // 시작점
              if (section.startPoint) {
                waypoints.push({
                  x: offsetX + section.startPoint.x,
                  y: offsetY + section.startPoint.y
                });
              }

              // 중간점 (bendPoints)
              if (Array.isArray(section.bendPoints)) {
                section.bendPoints.forEach(bp => {
                  waypoints.push({
                    x: offsetX + bp.x,
                    y: offsetY + bp.y
                  });
                });
              }

              // 끝점
              if (section.endPoint) {
                waypoints.push({
                  x: offsetX + section.endPoint.x,
                  y: offsetY + section.endPoint.y
                });
              }

              if (waypoints.length >= 2) {
                connection.waypoints = waypoints;
              }
            }
          }
        }

        // 자식 노드의 엣지 재귀 처리
        if (Array.isArray(elkNode.children)) {
          for (const child of elkNode.children) {
            const absX = offsetX + (child.x || 0);
            const absY = offsetY + (child.y || 0);
            applyEdgeRouting(child, absX, absY);
          }
        }
      }

      // Apply edge routing from ELK
      applyEdgeRouting(result, 0, 0);

      // [DEBUG] 엣지 교차 횟수 / 엣지-노드 중첩 횟수 자동 측정
      // (과제 품질 기준 중 "선 교차 최소화", "엣지-노드 중첩 없음"을 숫자로 확인하기 위함)
      if (DEBUG_LAYOUT_METRICS) {
        const segmentsOf = (waypoints) => {
          const segs = [];
          for (let i = 0; i < waypoints.length - 1; i++) segs.push([waypoints[i], waypoints[i + 1]]);
          return segs;
        };

        // 축 정렬(수평/수직) 선분 2개가 교차하는지 판정
        const segsIntersect = (a1, a2, b1, b2) => {
          const aH = Math.abs(a1.y - a2.y) < 0.5;
          const bH = Math.abs(b1.y - b2.y) < 0.5;
          if (aH === bH) return false; // 평행선은 (단순화를 위해) 교차로 안 셈
          const h = aH ? { y: a1.y, x1: Math.min(a1.x, a2.x), x2: Math.max(a1.x, a2.x) } : { y: b1.y, x1: Math.min(b1.x, b2.x), x2: Math.max(b1.x, b2.x) };
          const v = aH ? { x: b1.x, y1: Math.min(b1.y, b2.y), y2: Math.max(b1.y, b2.y) } : { x: a1.x, y1: Math.min(a1.y, a2.y), y2: Math.max(a1.y, a2.y) };
          const EPS = 0.5;
          return h.x1 - EPS <= v.x && v.x <= h.x2 + EPS && v.y1 - EPS <= h.y && h.y <= v.y2 + EPS;
        };

        // 선분이 사각형 "내부"를 관통하는지 판정 (경계에 살짝 닿는 건 정상이므로 제외)
        const segmentCrossesRectInterior = (p1, p2, rect, margin) => {
          const isHorizontal = Math.abs(p1.y - p2.y) < 0.5;
          if (isHorizontal) {
            const y = p1.y;
            if (!(y > rect.y1 + margin && y < rect.y2 - margin)) return false;
            const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
            return xMax > rect.x1 + margin && xMin < rect.x2 - margin;
          } else {
            const x = p1.x;
            if (!(x > rect.x1 + margin && x < rect.x2 - margin)) return false;
            const yMin = Math.min(p1.y, p2.y), yMax = Math.max(p1.y, p2.y);
            return yMax > rect.y1 + margin && yMin < rect.y2 - margin;
          }
        };

        const isAncestorOrSelf = (containerId, nodeId) => {
          let cur = nodeId;
          while (cur) {
            if (cur === containerId) return true;
            cur = parentOf.get(cur) || null;
          }
          return false;
        };

        const conns = (diagramData.connections || []).filter(c => Array.isArray(c.waypoints) && c.waypoints.length >= 2);

        // 1) 엣지끼리 교차 횟수
        let crossingCount = 0;
        const crossingPairs = [];
        for (let i = 0; i < conns.length; i++) {
          for (let j = i + 1; j < conns.length; j++) {
            const c1 = conns[i], c2 = conns[j];
            const sharesEndpoint = c1.source === c2.source || c1.source === c2.target || c1.target === c2.source || c1.target === c2.target;
            if (sharesEndpoint) continue; // 같은 노드에서 만나는 건 자연스러운 것이므로 제외
            const segs1 = segmentsOf(c1.waypoints);
            const segs2 = segmentsOf(c2.waypoints);
            let found = false;
            for (const [a1, a2] of segs1) {
              for (const [b1, b2] of segs2) {
                if (segsIntersect(a1, a2, b1, b2)) { found = true; break; }
              }
              if (found) break;
            }
            if (found) { crossingCount++; crossingPairs.push({ a: c1.id, b: c2.id }); }
          }
        }

        // 2) 엣지가 관계없는 노드 위를 지나가는 횟수
        let edgeNodeOverlapCount = 0;
        const edgeNodeOverlaps = [];
        const positionedNodes = diagramData.elements.filter(n => typeof n.x === 'number' && typeof n.width === 'number');
        const MARGIN = 2;
        for (const c of conns) {
          const segs = segmentsOf(c.waypoints);
          for (const n of positionedNodes) {
            if (n.id === c.source || n.id === c.target) continue;
            if (isAncestorOrSelf(n.id, c.source) || isAncestorOrSelf(n.id, c.target)) continue;
            const rect = { x1: n.x, y1: n.y, x2: n.x + n.width, y2: n.y + n.height };
            const hit = segs.some(([p1, p2]) => segmentCrossesRectInterior(p1, p2, rect, MARGIN));
            if (hit) { edgeNodeOverlapCount++; edgeNodeOverlaps.push({ edge: c.id, node: n.id }); }
          }
        }

        console.log(`[DEBUG elkLayout] 엣지 교차 수=${crossingCount}, 엣지-노드 중첩 수=${edgeNodeOverlapCount}`);
        if (crossingCount > 0) console.log('[DEBUG elkLayout] 교차하는 엣지 쌍:', crossingPairs);
        if (edgeNodeOverlapCount > 0) console.log('[DEBUG elkLayout] 노드를 지나가는 엣지:', edgeNodeOverlaps);

        // 3) 캔버스 밀도 (전체 바운딩박스 대비 leaf 노드 면적 비율) - "균일한 간격/여백" 비교용
        // 컨테이너(children이 있는 노드)는 면적 계산에서 제외하고 leaf 노드만 집계
        const leafNodes = positionedNodes.filter(n => !diagramData.elements.some(other => other.parent === n.id));
        const leafArea = leafNodes.reduce((sum, n) => sum + n.width * n.height, 0);
        const minX = Math.min(...positionedNodes.map(n => n.x));
        const minY = Math.min(...positionedNodes.map(n => n.y));
        const maxX = Math.max(...positionedNodes.map(n => n.x + n.width));
        const maxY = Math.max(...positionedNodes.map(n => n.y + n.height));
        const boundingArea = (maxX - minX) * (maxY - minY);
        const density = boundingArea > 0 ? (leafArea / boundingArea) : 0;
        console.log(`[DEBUG elkLayout] 캔버스 크기=${Math.round(maxX - minX)}x${Math.round(maxY - minY)}, leaf 노드 면적 합=${Math.round(leafArea)}, 밀도=${(density * 100).toFixed(1)}%`);

        // 4) 엣지 종단 명확성: 엣지의 시작점/끝점이 소스/타겟 노드 경계에 정확히 붙어있는지 확인
        const TOL = 4; // px 허용 오차
        const isOnRectBoundary = (px, py, rect) => {
          const nearX = Math.abs(px - rect.x1) <= TOL || Math.abs(px - rect.x2) <= TOL;
          const nearY = Math.abs(py - rect.y1) <= TOL || Math.abs(py - rect.y2) <= TOL;
          const withinYRange = py >= rect.y1 - TOL && py <= rect.y2 + TOL;
          const withinXRange = px >= rect.x1 - TOL && px <= rect.x2 + TOL;
          return (nearX && withinYRange) || (nearY && withinXRange);
        };
        let badEndpoints = 0;
        const badEndpointList = [];
        for (const c of conns) {
          const sNode = nodeById.get(c.source);
          const tNode = nodeById.get(c.target);
          if (!sNode || !tNode) continue;
          const sRect = { x1: sNode.x, y1: sNode.y, x2: sNode.x + sNode.width, y2: sNode.y + sNode.height };
          const tRect = { x1: tNode.x, y1: tNode.y, x2: tNode.x + tNode.width, y2: tNode.y + tNode.height };
          const startPt = c.waypoints[0];
          const endPt = c.waypoints[c.waypoints.length - 1];
          const startOk = isOnRectBoundary(startPt.x, startPt.y, sRect);
          const endOk = isOnRectBoundary(endPt.x, endPt.y, tRect);
          if (!startOk || !endOk) {
            badEndpoints++;
            badEndpointList.push({ edge: c.id, source: c.source, target: c.target, startOk, endOk });
          }
        }
        console.log(`[DEBUG elkLayout] 엣지 종단 불명확 수=${badEndpoints} / 전체 엣지 ${conns.length}개`);
        if (badEndpoints > 0) console.log('[DEBUG elkLayout] 종단이 불명확한 엣지:', badEndpointList);
      }

      // Post-process: align nodes in the same container & rank horizontally
      // RE-ENABLED: ELK spacing을 고려하도록 개선된 alignRanks 사용
      if (typeof NS.alignRanks === 'function') {
        try { 
          NS.alignRanks(diagramData, { 
            debug: true,  // 디버그 모드 활성화하여 로그 확인
            preserveElkSpacing: false  // 강제 정렬 모드로 테스트
          }); 
        } catch (e) { 
          console.log('[applyElkLayout] alignRanks failed', e); 
        }
      }
    } catch (err) {
      console.log('[applyElkLayout] error - falling back to grid', err);
      fallbackGrid(diagramData);
    }
  };

  function fallbackGrid(diagramData) {
    const DS = window.SELAB?.Editor?.config?.displaySettings;
    const FG = DS?.grid?.fallback;
    const paddingX = FG?.paddingX ?? 150;
    const paddingY = FG?.paddingY ?? 58;
    const elementWidth = FG?.elementWidth ?? 120;
    const elementHeight = FG?.elementHeight ?? 80;
    
    // 부모-자식 관계 파악
    const elements = diagramData.elements || [];
    const parentMap = new Map(); // childId -> parentId
    const childrenMap = new Map(); // parentId -> [childIds]
    
    for (const el of elements) {
      if (el.parent) {
        parentMap.set(el.id, el.parent);
        if (!childrenMap.has(el.parent)) {
          childrenMap.set(el.parent, []);
        }
        childrenMap.get(el.parent).push(el.id);
      }
    }
    
    // 루트 레벨 요소만 그리드 배치
    const rootElements = elements.filter(el => !el.parent);
    const cols = Math.max(1, Math.ceil(Math.sqrt(rootElements.length || 1)));
    
    rootElements.forEach((element, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      element.x = paddingX + col * (elementWidth + paddingX);
      element.y = paddingY + row * (elementHeight + paddingY);
      element.width = element.width || elementWidth;
      element.height = element.height || elementHeight;
    });
    
    // 자식 요소는 부모 내부에 배치
    for (const el of elements) {
      if (el.parent) {
        const parent = elements.find(p => p.id === el.parent || p.name === el.parent);
        if (parent) {
          const siblings = childrenMap.get(el.parent) || [];
          const siblingIndex = siblings.indexOf(el.id);
          const siblingCols = Math.max(1, Math.ceil(Math.sqrt(siblings.length)));
          const siblingRow = Math.floor(siblingIndex / siblingCols);
          const siblingCol = siblingIndex % siblingCols;
          
          const innerPadding = FG?.innerPadding ?? 60;
          el.x = parent.x + innerPadding + siblingCol * (elementWidth + paddingX);
          el.y = parent.y + innerPadding + siblingRow * (elementHeight + paddingY);
          el.width = el.width || elementWidth;
          el.height = el.height || elementHeight;
        }
      }
    }
  }

})();
