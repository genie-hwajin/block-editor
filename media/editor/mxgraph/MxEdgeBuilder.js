/* ********************************************************************************
 * Copyright: SELab.AI (c) 2026
 * MxEdgeBuilder.js - mxGraph 엣지 및 Border Node 생성
 * 정규화된 엣지/border node 데이터를 mxGraph 셀로 변환
 * ********************************************************************************/
(function () {
    'use strict';

    const ns = (window.SELAB = window.SELAB || {});
    ns.MxGraph = ns.MxGraph || {};
    ns.MxGraph.factory = ns.MxGraph.factory || {};

    const getTypeRegistry = () => ns.Editor?.config?.typeRegistry || {};

    function log(prefix, ...args) {
        try {
            console.log(`[MxEdgeBuilder] ${prefix}`, ...args);
        } catch (_) {}
    }

    /**
     * 계층적 엣지 타입 판별 (typeRegistry 사용)
     * @param {string} kind
     * @returns {boolean}
     */
    function isHierarchicalEdgeKind(kind) {
        const typeReg = getTypeRegistry();
        if (typeReg.isHierarchicalEdgeKind) {
            return typeReg.isHierarchicalEdgeKind(kind);
        }
        if (!kind) return false;
        const k = String(kind).toLowerCase();
        if (k.includes('import') || k.includes('expose')) return false;
        if (k.includes('inheritance') || k.includes('specialization') || k.includes('generalization')) return false;
        return (
            k.includes('contain') || k.includes('own') || k.includes('compose') ||
            k.includes('aggregate') || k.includes('nest') || k.includes('member') ||
            k.includes('usage') || k.includes('perform') || k.includes('include') || k.includes('has')
        );
    }

    /**
     * ELK waypoints 단순화 (불필요한 꺾임점 제거)
     * @param {Array} waypoints - [{x, y}, ...]
     * @returns {Array}
     */
    function simplifyWaypoints(waypoints) {
        if (!waypoints || waypoints.length <= 2) return waypoints;

        const result = [waypoints[0]];
        for (let i = 1; i < waypoints.length - 1; i++) {
            const prev = result[result.length - 1];
            const curr = waypoints[i];
            const next = waypoints[i + 1];
            const isCollinearH = Math.abs(prev.y - curr.y) < 1 && Math.abs(curr.y - next.y) < 1;
            const isCollinearV = Math.abs(prev.x - curr.x) < 1 && Math.abs(curr.x - next.x) < 1;
            if (isCollinearH || isCollinearV) continue;
            result.push(curr);
        }
        result.push(waypoints[waypoints.length - 1]);
        return result;
    }

    /**
     * Border node의 side에 따른 exit 스타일 반환
     * @param {mxCell} cell
     * @returns {string}
     */
    function getBorderNodeExitStyle(cell) {
        if (!cell?._isBorderNode || !cell._nodeData) return '';
        const side = String(cell._nodeData.side || 'E').toUpperCase();
        switch (side) {
            case 'N': return 'exitX=0.5;exitY=0;exitPerimeter=0';
            case 'S': return 'exitX=0.5;exitY=1;exitPerimeter=0';
            case 'W': return 'exitX=0;exitY=0.5;exitPerimeter=0';
            case 'E': default: return 'exitX=1;exitY=0.5;exitPerimeter=0';
        }
    }

    /**
     * Border node의 side에 따른 entry 스타일 반환
     * @param {mxCell} cell
     * @returns {string}
     */
    function getBorderNodeEntryStyle(cell) {
        if (!cell?._isBorderNode || !cell._nodeData) return '';
        const side = String(cell._nodeData.side || 'E').toUpperCase();
        switch (side) {
            case 'N': return 'entryX=0.5;entryY=0;entryPerimeter=0';
            case 'S': return 'entryX=0.5;entryY=1;entryPerimeter=0';
            case 'W': return 'entryX=0;entryY=0.5;entryPerimeter=0';
            case 'E': default: return 'entryX=1;entryY=0.5;entryPerimeter=0';
        }
    }

    /**
     * 같은 노드에 여러 엣지가 연결될 때 연결점을 분산 배치 (겹침 방지)
     * @param {mxGraph} graph
     */
    function distributeOverlappingEdges(graph) {
        const model = graph.getModel();
        const defaultParent = graph.getDefaultParent();

        const allEdges = [];
        function collectEdges(cell) {
            const childCount = model.getChildCount(cell);
            for (let i = 0; i < childCount; i++) {
                const child = model.getChildAt(cell, i);
                if (model.isEdge(child)) allEdges.push(child);
                else if (model.isVertex(child)) collectEdges(child);
            }
        }
        collectEdges(defaultParent);
        if (allEdges.length < 2) return;

        function absCenter(cell) {
            if (!cell) return null;
            const geo = model.getGeometry(cell);
            if (!geo) return null;
            let x = geo.x || 0, y = geo.y || 0;
            const w = geo.width || 0, h = geo.height || 0;
            let p = cell.parent;
            while (p && p !== defaultParent && p !== model.getRoot()) {
                const pg = model.getGeometry(p);
                if (pg) { x += pg.x || 0; y += pg.y || 0; }
                p = p.parent;
            }
            return { x: x + w / 2, y: y + h / 2 };
        }

        function absBounds(cell) {
            if (!cell) return null;
            const geo = model.getGeometry(cell);
            if (!geo) return null;
            let x = geo.x || 0, y = geo.y || 0;
            const w = geo.width || 0, h = geo.height || 0;
            let p = cell.parent;
            while (p && p !== defaultParent && p !== model.getRoot()) {
                const pg = model.getGeometry(p);
                if (pg) { x += pg.x || 0; y += pg.y || 0; }
                p = p.parent;
            }
            return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
        }

        function exitSideFor(refCell, otherCenter) {
            const rb = absBounds(refCell);
            if (!rb || !otherCenter) return null;
            const right = rb.x + rb.w, bottom = rb.y + rb.h;
            if (otherCenter.y >= bottom) return 'S';
            if (otherCenter.y <= rb.y) return 'N';
            if (otherCenter.x >= right) return 'E';
            if (otherCenter.x <= rb.x) return 'W';
            const dS = bottom - otherCenter.y;
            const dN = otherCenter.y - rb.y;
            const dE = right - otherCenter.x;
            const dW = otherCenter.x - rb.x;
            const min = Math.min(dS, dN, dE, dW);
            if (min === dS) return 'S';
            if (min === dN) return 'N';
            if (min === dE) return 'E';
            return 'W';
        }

        function xyForSide(s, frac) {
            if (s === 'S') return [frac, 1];
            if (s === 'N') return [frac, 0];
            if (s === 'E') return [1, frac];
            return [0, frac];
        }

        const bySource = new Map(), byTarget = new Map();
        for (const e of allEdges) {
            if (!e.source || !e.target) continue;
            if (!e.source._isBorderNode) {
                const k = e.source.id;
                if (!bySource.has(k)) bySource.set(k, []);
                bySource.get(k).push(e);
            }
            if (!e.target._isBorderNode) {
                const k = e.target.id;
                if (!byTarget.has(k)) byTarget.set(k, []);
                byTarget.get(k).push(e);
            }
        }

        let count = 0;
        model.beginUpdate();
        try {
            for (const [, group] of bySource) {
                if (group.length <= 1) continue;
                const bySide = {};
                for (const e of group) {
                    const tc = absCenter(e.target);
                    if (!tc) continue;
                    const s = exitSideFor(e.source, tc);
                    if (!s) continue;
                    if (!bySide[s]) bySide[s] = [];
                    bySide[s].push({ e, perp: (s === 'N' || s === 'S') ? tc.x : tc.y });
                }
                for (const [s, arr] of Object.entries(bySide)) {
                    if (arr.length <= 1) continue;
                    arr.sort((a, b) => a.perp - b.perp);
                    for (let i = 0; i < arr.length; i++) {
                        if (arr[i].e._hasElkWaypoints) continue;
                        let st = model.getStyle(arr[i].e) || '';
                        if (st.includes('exitX=')) continue;
                        const [eX, eY] = xyForSide(s, (i + 1) / (arr.length + 1));
                        st += `;exitX=${eX.toFixed(2)};exitY=${eY.toFixed(2)};exitPerimeter=0`;
                        model.setStyle(arr[i].e, st);
                        count++;
                    }
                }
            }
            for (const [, group] of byTarget) {
                if (group.length <= 1) continue;
                const bySide = {};
                for (const e of group) {
                    const sc = absCenter(e.source);
                    if (!sc) continue;
                    const s = exitSideFor(e.target, sc);
                    if (!s) continue;
                    if (!bySide[s]) bySide[s] = [];
                    bySide[s].push({ e, perp: (s === 'N' || s === 'S') ? sc.x : sc.y });
                }
                for (const [s, arr] of Object.entries(bySide)) {
                    if (arr.length <= 1) continue;
                    arr.sort((a, b) => a.perp - b.perp);
                    for (let i = 0; i < arr.length; i++) {
                        if (arr[i].e._hasElkWaypoints) continue;
                        let st = model.getStyle(arr[i].e) || '';
                        if (st.includes('entryX=')) continue;
                        const [nX, nY] = xyForSide(s, (i + 1) / (arr.length + 1));
                        st += `;entryX=${nX.toFixed(2)};entryY=${nY.toFixed(2)};entryPerimeter=0`;
                        model.setStyle(arr[i].e, st);
                        count++;
                    }
                }
            }
        } finally {
            model.endUpdate();
        }
        if (count > 0) log(`엣지 분산 배치: ${count}개 연결점 조정`);
    }

    /**
     * ELK waypoints를 엣지 셀에 적용
     * @param {mxGraph} graph
     * @param {mxCell} edgeCell
     * @param {Object} edge - 엣지 데이터 (waypoints 포함)
     * @param {mxCell} sourceCell
     * @param {mxCell} targetCell
     */
    function applyElkWaypoints(graph, edgeCell, edge, sourceCell, targetCell) {
        const simplified = simplifyWaypoints(edge.waypoints);
        if (!simplified || simplified.length < 2) return;

        const model = graph.getModel();
        model.beginUpdate();
        try {
            const defaultParent = graph.getDefaultParent();

            function getCellAbsBounds(cell) {
                if (!cell) return null;
                const g = model.getGeometry(cell);
                if (!g) return null;
                let cx = g.x || 0, cy = g.y || 0;
                const w = g.width || 0, h = g.height || 0;
                let p = cell.parent;
                while (p && p !== defaultParent && p !== model.getRoot()) {
                    const pg = model.getGeometry(p);
                    if (pg) { cx += pg.x || 0; cy += pg.y || 0; }
                    p = p.parent;
                }
                return { x: cx, y: cy, w, h };
            }

            // ELK waypoints를 geometry.points로 설정
            // startPoint도 포함(slice(0,-1))하여 mxGraph가 exitX/exitY 없이도 올바른 경로를 따르도록 함
            // exitX/exitY + geometry.points(bendPoints만) 조합 시 orthogonal router가 두 점 사이에
            // 추가 세그먼트를 삽입하여 꺾임점 오버슈팅 현상이 발생하므로 이 방식으로 변경
            const geoPoints = simplified.slice(0, -1); // startPoint + bendPoints (endPoint 제외)
            if (geoPoints.length > 0) {
                const geo = model.getGeometry(edgeCell);
                if (geo) {
                    const newGeo = geo.clone();
                    newGeo.points = geoPoints.map(p => ({ x: p.x, y: p.y }));
                    model.setGeometry(edgeCell, newGeo);
                }
            }

            let currentStyle = model.getStyle(edgeCell) || '';

            // border node는 side 기반 고정 좌표 사용 (ELK waypoints 대신)
            const srcIsBN = sourceCell._isBorderNode === true;
            const tgtIsBN = targetCell._isBorderNode === true;

            if (!currentStyle.includes('exitX=')) {
                if (srcIsBN) {
                    const bnExit = getBorderNodeExitStyle(sourceCell);
                    if (bnExit) currentStyle += `;${bnExit}`;
                }
                // 일반 노드: exitX/Y 추가 안 함 → geometry.points[0](=startPoint)이 자동으로 exit 역할
            }
            if (!currentStyle.includes('entryX=')) {
                if (tgtIsBN) {
                    const bnEntry = getBorderNodeEntryStyle(targetCell);
                    if (bnEntry) currentStyle += `;${bnEntry}`;
                } else {
                    const wpN = simplified[simplified.length - 1];
                    const tgtB = getCellAbsBounds(targetCell);
                    if (tgtB && tgtB.w > 0 && tgtB.h > 0) {
                        const clamp01 = (v) => Math.max(0, Math.min(1, v));
                        const nx = clamp01((wpN.x - tgtB.x) / tgtB.w);
                        const ny = clamp01((wpN.y - tgtB.y) / tgtB.h);
                        currentStyle += `;entryX=${nx.toFixed(3)};entryY=${ny.toFixed(3)};entryPerimeter=0`;
                    }
                }
            }
            model.setStyle(edgeCell, currentStyle);
            edgeCell._hasElkWaypoints = true;
        } finally {
            model.endUpdate();
        }
    }

    /**
     * 정규화된 엣지를 mxGraph 엣지로 변환
     * @param {mxGraph} graph
     * @param {Object} parent - 부모 셀
     * @param {Object} edge - 정규화된 엣지 데이터
     * @param {Object} cellMap - id → mxCell 매핑
     * @param {Set} borderNodeIds
     * @returns {mxCell|null}
     */
    function createEdge(graph, parent, edge, cellMap, borderNodeIds) {
        if (!graph || !edge) return null;

        const {
            id,
            source: sourceId,
            target: targetId,
            type = 'default',
            kind = '',
            label = ''
        } = edge;

        const edgeType = kind || type || 'default';
        const edgeTypeLower = edgeType.toLowerCase();

        // Import/Expose 엣지 자동 라벨
        let edgeLabel = label;
        if (!edgeLabel && (edgeTypeLower.includes('import') || edgeTypeLower.includes('expose'))) {
            if (edgeTypeLower.includes('import')) {
                if (edgeTypeLower === 'membershipimport') edgeLabel = '«import»';
                else if (edgeTypeLower === 'namespaceimport') edgeLabel = '«import» *';
                else edgeLabel = '«import»';
            } else if (edgeTypeLower.includes('expose')) {
                edgeLabel = '«expose»';
            }
        }

        // 계층적 엣지 제외
        const isHierarchical = isHierarchicalEdgeKind(edgeType);
        if (isHierarchical && !edge.kindClass) {
            return null;
        }

        if (edgeTypeLower === 'containment') return null;
        if (id && String(id).startsWith('_implicit_')) return null;

        // cross-container featuretyping 엣지 필터링
        if (edgeTypeLower === 'featuretyping') {
            const sLast = String(sourceId).lastIndexOf('::');
            const tLast = String(targetId).lastIndexOf('::');
            const sParent = sLast > 0 ? sourceId.substring(0, sLast) : '';
            const tParent = tLast > 0 ? targetId.substring(0, tLast) : '';
            if (sParent !== tParent) {
                const sourceCell = cellMap[sourceId];
                const srcType = String(sourceCell?._nodeData?.type || '').toLowerCase();
                if (srcType.includes('action') && !cellMap[targetId]) return null;
            }
        }

        const sourceCell = cellMap[sourceId];
        const targetCell = cellMap[targetId];

        if (!sourceCell || !targetCell) {
            if (!borderNodeIds || !borderNodeIds.has(targetId)) {
                log('엣지 생성 실패 - 소스/타겟 없음:', id, sourceId, targetId);
            }
            return null;
        }

        let style = ns.MxGraph.styles?.getEdgeStyle?.(edgeType) || '';

        const srcIsBorderNode = sourceCell._isBorderNode === true;
        const tgtIsBorderNode = targetCell._isBorderNode === true;
        const borderNodeFeaturetyping = (srcIsBorderNode || tgtIsBorderNode) && edgeTypeLower === 'featuretyping';
        const hasElkWaypoints = !borderNodeFeaturetyping && edge.waypoints && Array.isArray(edge.waypoints) && edge.waypoints.length >= 2;

        if (!hasElkWaypoints) {
            const exitStyle = getBorderNodeExitStyle(sourceCell);
            const entryStyle = getBorderNodeEntryStyle(targetCell);
            if (exitStyle) style += `;${exitStyle}`;
            if (entryStyle) style += `;${entryStyle}`;
        }

        const edgeCell = graph.insertEdge(parent, id, edgeLabel, sourceCell, targetCell, style);

        if (hasElkWaypoints) {
            applyElkWaypoints(graph, edgeCell, edge, sourceCell, targetCell);
        }

        edgeCell._edgeData = edge;
        return edgeCell;
    }

    /**
     * Border Node 생성 (부모 셀의 테두리에 작은 사각형으로 표시)
     * @param {mxGraph} graph
     * @param {mxCell} parentCell
     * @param {Object} borderNode
     * @param {number} index
     * @param {number} total
     * @param {number} sideIndex
     * @param {number} sideTotal
     * @returns {mxCell|null}
     */
    function createBorderNode(graph, parentCell, borderNode, index, total, sideIndex, sideTotal) {
        if (!graph || !parentCell || !borderNode) return null;

        const parentGeo = parentCell.getGeometry();
        if (!parentGeo) return null;

        const DS_bn = window.SELAB?.Editor?.config?.displaySettings;
        const size = DS_bn?.borderNode?.size ?? 12;
        const dirLower = String(borderNode.direction || '').toLowerCase();
        const isParameterPin = borderNode.nodeType === 'parameter' || borderNode.isParameter === true;

        const side = String(borderNode.side || 'E').toUpperCase();
        // processBorderNodes에서 이미 offset을 계산한 경우 그 값 우선 사용
        // 기본값(0.5)이면 sideIndex 기반 폴백 계산 적용
        const hasPrecomputedOffset = typeof borderNode.offset === 'number' && borderNode.offset !== 0.5;
        const computedOffset = hasPrecomputedOffset
            ? borderNode.offset
            : (typeof sideIndex === 'number' && typeof sideTotal === 'number' && sideTotal > 0)
                ? (sideIndex + 1) / (sideTotal + 1)
                : 0.25;
        const offset = Math.max(0, Math.min(1, computedOffset));

        // [FIX] E/W측 포트는 offset(0.15~0.85)을 박스 "전체 높이"에 곱한 위치에 배치되는데,
        // 이러면 짧은 박스(포트만 있고 compartment가 거의 없는 경우)에서 offset이 낮을 때
        // (예: 포트 1개면 offset=0.25) 제목 라벨 영역(헤더)과 겹치게 됨.
        // 헤더 높이(headerClearance)만큼 먼저 확보해두고, 그 아래 남는 공간에만 offset 비율을 적용해
        // 박스 높이에 관계없이 항상 헤더 아래에 배치되도록 함.
        const headerClearance = DS_bn?.borderNode?.headerClearance ?? 44;
        const parentHeight = parentGeo.height || 0;
        const usableHeight = Math.max(1, parentHeight - headerClearance);
        const ewRelativeY = parentHeight > 0
            ? Math.min(1, (headerClearance + offset * usableHeight) / parentHeight)
            : offset;

        let relativeX = 1, relativeY = ewRelativeY;
        let geoOffsetX = -size / 2, geoOffsetY = -size / 2;
        let portConstraint = 'eastwest';

        switch (side) {
            case 'N':
                // [FIX] N측(direction='in'/'inout'인 포트가 자동으로 배정됨)은 relativeY=0으로
                // 박스의 "맨 위 경계선"에 고정되는데, 이는 컨테이너 제목이 그려지는 위치와 정확히 겹침.
                // 박스 높이와 무관하게 항상 겹치므로(E/W측과 달리 offset 비율 문제가 아님),
                // relativeY는 0으로 두되 절대 픽셀 오프셋(geoOffsetY)으로 headerClearance만큼 아래로 밀어냄.
                relativeX = offset; relativeY = 0;
                geoOffsetX = -size / 2; geoOffsetY = headerClearance - size / 2;
                portConstraint = 'northsouth';
                break;
            case 'S':
                relativeX = offset; relativeY = 1;
                geoOffsetX = -size / 2; geoOffsetY = -size / 2;
                portConstraint = 'northsouth';
                break;
            case 'W':
                relativeX = 0; relativeY = ewRelativeY;
                geoOffsetX = -size / 2; geoOffsetY = -size / 2;
                portConstraint = 'eastwest';
                break;
            case 'E': default:
                relativeX = 1; relativeY = ewRelativeY;
                geoOffsetX = -size / 2; geoOffsetY = -size / 2;
                portConstraint = 'eastwest';
                break;
        }

        const isItem = borderNode.nodeType === 'item' || borderNode.nodeType === 'directedItem';
        const isDark = ns.MxGraph.styleColors?.isDarkTheme?.() || false;
        const strokeColor = isItem ? '#4CAF50' : (isDark ? '#999999' : '#333333');
        const bnFillColor = isDark ? '#2d2d2d' : '#FFFFFF';
        const bnFontColor = isDark ? '#e0e0e0' : '#333333';

        const bnSpTop = DS_bn?.borderNode?.spacingTop ?? 2;
        const bnSpBot = DS_bn?.borderNode?.spacingBottom ?? 2;
        let verticalLabelPosition = 'bottom';
        let verticalAlignValue = 'top';
        let spacingTopValue = bnSpTop;
        let spacingBottomValue = null;

        const isDirectedIn = dirLower === 'in' || dirLower.startsWith('in');
        const isDirectedOut = dirLower === 'out' || dirLower.startsWith('out');

        if ((isParameterPin || isItem) && isDirectedIn) {
            verticalLabelPosition = 'top';
            verticalAlignValue = 'bottom';
            spacingTopValue = null;
            spacingBottomValue = bnSpBot + 1; // 2 + 1 = 3
        } else if ((isParameterPin || isItem) && isDirectedOut) {
            verticalLabelPosition = 'bottom';
            verticalAlignValue = 'top';
            spacingTopValue = bnSpTop - 2; // Reduce space to make it look balanced with 'in'
        }

        const styleParts = [
            'shape=rectangle',
            `fillColor=${bnFillColor}`,
            `strokeColor=${strokeColor}`,
            'strokeWidth=2',
            'fontSize=8',
            `fontColor=${bnFontColor}`,
            `portConstraint=${portConstraint}`,
            'labelPosition=center',
            `verticalLabelPosition=${verticalLabelPosition}`,
            'align=center',
            `verticalAlign=${verticalAlignValue}`,
        ];
        if (spacingTopValue !== null) styleParts.push(`spacingTop=${spacingTopValue}`);
        if (spacingBottomValue !== null) styleParts.push(`spacingBottom=${spacingBottomValue}`);
        const style = styleParts.join(';');

        let label = borderNode.name || '';
        const borderNodeTypeLower = String(borderNode.nodeType || borderNode.type || borderNode.kind || '').toLowerCase();
        const shouldShowTypeName = !isParameterPin &&
            borderNode.typeName &&
            !((borderNodeTypeLower === 'item' || borderNodeTypeLower === 'itemusage' || borderNodeTypeLower === 'directeditem') &&
                String(borderNode.typeName).toLowerCase() === 'item');
        if (shouldShowTypeName) {
            label = `${label} : ${borderNode.typeName}`;
        }

        const borderCell = graph.insertVertex(
            parentCell,
            borderNode.id,
            label,
            relativeX, relativeY,
            size, size,
            style
        );

        const geo = borderCell.getGeometry();
        if (geo) {
            geo.relative = true;
            geo.offset = new mxPoint(geoOffsetX, geoOffsetY);
        }

        borderCell._nodeData = borderNode;
        borderCell._isBorderNode = true;

        return borderCell;
    }

    // Export
    ns.MxGraph.factory.createEdge = createEdge;
    ns.MxGraph.factory.createBorderNode = createBorderNode;
    ns.MxGraph.factory.distributeOverlappingEdges = distributeOverlappingEdges;
    ns.MxGraph.factory.isHierarchicalEdgeKind = isHierarchicalEdgeKind;

    console.log('[MxEdgeBuilder] 모듈 로드 완료');
})();
