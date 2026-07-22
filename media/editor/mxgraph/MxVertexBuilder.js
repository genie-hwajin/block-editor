/* ********************************************************************************
 * Copyright: SELab.AI (c) 2026
 * MxVertexBuilder.js - mxGraph 버텍스(노드) 생성
 * 정규화된 노드 데이터를 mxGraph 버텍스 셀로 변환
 * ********************************************************************************/
(function () {
    'use strict';

    const ns = (window.SELAB = window.SELAB || {});
    ns.MxGraph = ns.MxGraph || {};
    ns.MxGraph.factory = ns.MxGraph.factory || {};

    // 지연 바인딩
    const labelUtils = () => ns.MxGraph.labelUtils;
    const compartment = () => ns.MxGraph.compartment;
    const typeUtils = () => ns.MxGraph.typeUtils;
    const getTypeRegistry = () => ns.MxGraph.typeUtils?.getTypeRegistry?.() || ns.Editor?.config?.typeRegistry || {};

    function log(prefix, ...args) {
        try {
            console.log(`[MxVertexBuilder] ${prefix}`, ...args);
        } catch (_) {}
    }

    /**
     * 주석 본문을 mxGraph 라벨에 맞게 정규화
     * - 단일 줄바꿈은 공백으로 변경
     * - 빈 줄(단락 구분)과 불릿/번호 목록 줄은 유지
     * @param {string} bodyText
     * @returns {string}
     */
    function normalizeAnnotationBody(bodyText) {
        if (!bodyText) return '';

        const normalized = String(bodyText).replace(/\r\n/g, '\n');
        const bulletPattern = /^([-*•]|[0-9]+[.)])\s+/;
        const lines = normalized.split('\n').map((line) => line.trim());
        const merged = [];

        for (const line of lines) {
            if (line.length === 0) {
                merged.push('');
                continue;
            }
            const lastIndex = merged.length - 1;
            const lastLine = merged[lastIndex];
            if (lastIndex === -1 || lastLine === '' || bulletPattern.test(line)) {
                merged.push(line);
                continue;
            }
            merged[lastIndex] = `${lastLine} ${line}`.replace(/\s{2,}/g, ' ').trim();
        }

        return merged.join('\n').trim();
    }

    /**
     * 노드 타입별 라벨 및 높이 계산
     * @param {Object} node - 정규화된 노드 데이터
     * @param {string} elementType - 요소 타입
     * @param {string} typeLower - 소문자 타입
     * @param {string} roleLower - 소문자 role
     * @param {boolean} isTerminateRole
     * @param {number} height - 기본 높이
     * @returns {{ label: string, adjustedHeight: number, style?: string }}
     */
    function buildLabelAndHeight(node, elementType, typeLower, roleLower, isTerminateRole, height) {
        const typeReg = getTypeRegistry();
        const formatLabel = labelUtils()?.formatLabel || ((n) => n);
        let label;
        let adjustedHeight = height;
        let styleOverride;

        if (typeReg.isAnnotationType?.(typeLower) || typeLower === 'comment' || typeLower === 'documentation' || typeLower === 'metadatausage') {
            let stereotype;
            if (typeLower === 'documentation') stereotype = '«doc»';
            else if (typeLower === 'metadatausage') stereotype = '«metadata»';
            else stereotype = '«comment»';

            const bodyText = node.body || '';
            const cleanBody = normalizeAnnotationBody(
                bodyText.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim()
            );
            const hasRealName = node.name && node.name !== 'doc' && node.name !== 'comment' && node.name !== 'metadata' && node.name !== typeLower;
            label = hasRealName ? `${stereotype}\n${node.name}` : stereotype;

            if (cleanBody) {
                label += `\n${cleanBody}`;
                const baseLines = hasRealName ? 2 : 1;
                const bodyLines = cleanBody.split('\n').length;
                const extraLines = baseLines + bodyLines;
                adjustedHeight = Math.max(height, 40 + (extraLines * 16) + 20);
                log(`Comment 높이 조정: ${node.name}, 원본=${height}, 조정=${adjustedHeight}, 줄수=${extraLines}`);
            }

        } else if (typeReg.isAliasType?.(typeLower) || typeLower === 'alias') {
            label = node.label || `«alias»\n${node.name}\nfor ${node.targetName || 'Unknown'}`;
            styleOverride = 'shape=rectangle;rounded=1;fillColor=#FFFACD;strokeColor=#000000;strokeWidth=1;';

        } else if (typeReg.isLoopActionType?.(typeLower) || typeLower === 'loop' || typeLower.includes('loopaction')) {
            label = formatLabel(node.name, elementType, { isAbstract: node.isAbstract, isVariation: node.isVariation, stereotype: node.stereotype });
            let extraLines = 0;
            const DS_loop = window.SELAB?.Editor?.config?.displaySettings;
            let loopBodyStartY = DS_loop?.mxCellFactory?.loopBodyStartY ?? 40;

            if (Array.isArray(node.compartments) && node.compartments.length > 0) {
                for (const comp of node.compartments) {
                    const compKey = comp.key || '';
                    const items = Array.isArray(comp.items) ? comp.items : [];
                    if (compKey === 'loop body') {
                        label += `<hr style="margin:4px 0;border:none;border-top:1px solid #888;">`;
                        label += `<div style="text-align:left;padding:2px 4px;font-style:italic;font-weight:bold;">${compKey}</div>`;
                        extraLines += 2;
                        if (comp.headerOnly !== true && items.length > 0) {
                            loopBodyStartY += extraLines * 16 + 10;
                            node._loopBodyComp = comp;
                            node._loopBodyStartY = loopBodyStartY;
                        }
                        continue;
                    }
                    label += `<hr style="margin:4px 0;border:none;border-top:1px solid #888;">`;
                    label += `<div style="text-align:left;padding:2px 4px;font-style:italic;font-weight:bold;">${compKey}</div>`;
                    extraLines += 2;
                    for (const item of items) {
                        const itemName = typeof item === 'object' ? (item.name || '') : String(item);
                        label += `<div style="text-align:left;padding:1px 8px;">${itemName}</div>`;
                        extraLines += 1;
                    }
                }
            } else {
                if (node.body) {
                    label += `\n─────────\n${node.body}`;
                    extraLines += node.body.split('\n').length + 1;
                }
                if (node.until) {
                    label += `\n─────────\n${node.until}`;
                    extraLines += 2;
                }
            }

            if (node._loopBodyComp) {
                const bodyItemCount = node._loopBodyComp.items?.length || 0;
                adjustedHeight = Math.max(height, 100 + (bodyItemCount * 80));
            } else if (extraLines > 0) {
                adjustedHeight = Math.max(height, 60 + (extraLines * 16) + 20);
            }

        } else if (typeReg.isIfActionType?.(typeLower) || typeLower === 'ifactionusage' || typeLower.includes('ifaction') || typeLower === 'elseifaction' || typeLower === 'elseaction') {
            // IfAction/ElseIfAction/ElseAction: guard 조건은 헤더에서 렌더링, then/else body는 자식 노드로 분리
            label = formatLabel(node.name, elementType, { isAbstract: node.isAbstract, isVariation: node.isVariation, stereotype: node.stereotype });
            if (node.guard) {
                label += `\n${node.guard}`;
                adjustedHeight = Math.max(height, 80);
            }

        } else if (isTerminateRole) {
            const stereotype = node.stereotype || '«terminate»';
            label = `${stereotype}\n${node.name}`;

        } else {
            label = formatLabel(node.name, elementType, {
                isAbstract: node.isAbstract,
                isVariation: node.isVariation,
                isIndividual: node.isIndividual,
                declaredType: node.declaredType,
                stereotype: node.stereotype,
                isPortion: node.isPortion,
                portionKind: node.portionKind,
                specializationTargets: node.specializationTargets
            });
        }

        return { label, adjustedHeight, styleOverride };
    }

    /**
     * compartment 렌더링 대상 여부 판단
     * @param {string} typeLower
     * @param {boolean} isAnnotationNode
     * @param {boolean} isTerminateRole
     * @returns {boolean}
     */
    function isCompartmentTarget(typeLower, isAnnotationNode, isTerminateRole) {
        if (isAnnotationNode || isTerminateRole) return false;
        return typeUtils()?.isContainerLikeType?.(typeLower) ?? false;
    }

    /**
     * 정규화된 노드를 mxGraph 버텍스로 변환
     * @param {mxGraph} graph - mxGraph 인스턴스
     * @param {Object} parent - 부모 셀
     * @param {Object} node - 정규화된 노드 데이터
     * @param {Object} parentNode - 부모 노드 데이터
     * @param {Object} cellMap - id -> cell 매핑
     * @param {boolean} hasGraphChildren - 그래프상 자식 노드 존재 여부
     * @returns {mxCell} 생성된 셀
     */
    function createVertex(graph, parent, node, parentNode, cellMap, hasGraphChildren = false) {
        if (!graph || !node) return null;
        if (node.hidden) return null;

        const {
            id,
            name = '',
            type = 'default',
            kind = '',
            role = '',
            x = 0,
            y = 0,
            width = 120,
            height = 60
        } = node;

        const elementType = type || kind || 'default';
        const typeLower = elementType.toLowerCase();
        const roleLower = String(role || '').toLowerCase();
        const typeReg = getTypeRegistry();

        const isTerminateRole = (
            typeReg.isTerminateActionType?.(typeLower, roleLower) ||
            roleLower === 'terminate' ||
            typeLower.includes('terminateaction')
        ) && !typeLower.includes('package') && !roleLower.includes('package');

        let style = ns.MxGraph.styles?.getVertexStyle?.(elementType, node) || '';

        const isAnnotationNode = !!(typeReg.isAnnotationType?.(typeLower) || typeLower === 'comment' || typeLower === 'documentation' || typeLower === 'metadatausage');

        const { label: rawLabel, adjustedHeight, styleOverride } = buildLabelAndHeight(
            node, elementType, typeLower, roleLower, isTerminateRole, height
        );
        let label = rawLabel;
        if (styleOverride) style = styleOverride;

        const getRoleStyleOverrides = labelUtils()?.getRoleStyleOverrides || ((r, t, b) => b);
        const finalWidth = node.width || width;
        const finalHeight = node.height || adjustedHeight;
        const effectiveRole = (typeLower.includes('package') || roleLower.includes('package')) ? '' : roleLower;

        const override = getRoleStyleOverrides(effectiveRole, typeLower, {
            style,
            label,
            name,
            width: finalWidth,
            height: finalHeight
        });

        style = override.style;
        label = override.label;

        // 자식이 있는 컨테이너 노드: 타이틀을 상단에 배치
        // [FIX] 기존에는 hasGraphChildren(실제 .parent 자식이 있는 경우)만 체크했음.
        // 그런데 compartment(attribute def 등)나 border node(포트)만 있고 실제 자식은 없는
        // 노드(RenderEngine, LoadBalancer 등)는 verticalAlign이 'middle'로 남아서, 타이틀이
        // 박스 세로 중앙에 렌더링됨. 반면 MxCompartmentRenderer.js는 타이틀이 항상 "상단"에
        // 있다고 가정하고 그 아래(y=labelHeight)에 compartment/ports 섹션을 배치하므로,
        // 실제로는 세로 중앙에 있는 타이틀과 겹치는 버그가 있었음.
        // compartment나 border node가 있는 경우에도 상단 정렬하도록 조건 확장.
        const hasCompartmentsOrPorts = (Array.isArray(node?.compartments) && node.compartments.length > 0) ||
            (Array.isArray(node?.borderNodes) && node.borderNodes.length > 0);
        if ((hasGraphChildren || hasCompartmentsOrPorts) && style.includes('verticalAlign=middle')) {
            style = style.replace('verticalAlign=middle', 'verticalAlign=top');
        }

        let localX;
        let localY;

        if (parent !== graph.getDefaultParent() && parentNode) {
            // 자식 노드: ELK relativeX/Y(부모 기준 상대좌표) 사용
            localX = typeof node.relativeX === 'number' ? node.relativeX : (x || 10);
            localY = typeof node.relativeY === 'number' ? node.relativeY : (y || 35);
        } else {
            // 루트 노드: 절대 좌표 사용
            localX = typeof node.relativeX === 'number' ? node.relativeX : x;
            localY = typeof node.relativeY === 'number' ? node.relativeY : y;
        }

        // collapsed 상태에서 라벨 ellipsis 처리
        let finalLabel = label;
        if (node._collapsed) {
            const truncate = ns.MxGraph.fold?.truncateLabel;
            if (typeof truncate === 'function') {
                finalLabel = truncate(label, 12);
            } else {
                // fallback: 직접 truncate
                const plainText = String(label || '').replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();
                finalLabel = plainText.length > 12 ? plainText.substring(0, 12) + '...' : plainText;
            }
        }

        // html=1 모드에서 overflow=fill인 경우 padding 처리
        if (finalLabel && style.includes('html=1') && style.includes('overflow=fill')) {
            const escaped = String(finalLabel).replace(/\n/g, '<br/>');
            finalLabel = '<div style="padding:6px 6px 0 6px;">' + escaped + '</div>';
        }

        const vertex = graph.insertVertex(
            parent, id, finalLabel,
            localX, localY,
            override.width, override.height,
            style
        );

        // 자식 노드의 geometry를 부모 기준 상대 좌표로 명시적으로 설정
        if (parent !== graph.getDefaultParent()) {
            const geo = vertex.getGeometry();
            if (geo) {
                geo.relative = false;
                vertex.setGeometry(geo);
            }
        }

        vertex._nodeData = node;

        // Loop body compartment 자식 셀 렌더링
        if (node._loopBodyComp && node._loopBodyStartY) {
            const createLoopBodyCells = compartment()?.createLoopBodyCells;
            if (createLoopBodyCells) {
                const loopBodyCells = createLoopBodyCells(graph, vertex, node._loopBodyComp, node._loopBodyStartY);
                if (loopBodyCells && typeof loopBodyCells === 'object') {
                    Object.assign(cellMap, loopBodyCells);
                }
            }
            delete node._loopBodyComp;
            delete node._loopBodyStartY;
        }

        // role 라벨 셀 생성
        if (override.roleLabel) {
            const createRoleLabelCell = labelUtils()?.createRoleLabelCell;
            if (createRoleLabelCell) {
                createRoleLabelCell(graph, vertex, override.roleLabel);
            }
        }

        // Compartment 렌더링 (_collapsed 상태이면 스킵)
        if (isCompartmentTarget(typeLower, isAnnotationNode, isTerminateRole) && !node._collapsed) {
            let compartments = node.compartments || [];
            if (compartments.length === 0 && ns.Editor?.render?.elements?.getCompartments) {
                const app = ns.MxGraph._currentApp;
                if (app) {
                    compartments = ns.Editor.render.elements.getCompartments(node, app);
                }
            }
            if (compartments.length > 0) {
                const createCompartmentCells = compartment()?.createCompartmentCells;
                if (createCompartmentCells) {
                    const actionFlowCells = createCompartmentCells(graph, vertex, compartments, { hasGraphChildren });
                    if (actionFlowCells && typeof actionFlowCells === 'object') {
                        Object.assign(cellMap, actionFlowCells);
                    }
                }
                if (node.width && node.height) {
                    const geo = vertex.getGeometry();
                    if (geo && (Math.abs(geo.height - node.height) > 1 || Math.abs(geo.width - node.width) > 1)) {
                        const newGeo = geo.clone();
                        newGeo.width = node.width;
                        newGeo.height = node.height;
                        graph.getModel().setGeometry(vertex, newGeo);
                    }
                }
                // fold 대상 판단에 사용할 compartment 존재 플래그 저장
                node._hasCompartments = true;
            }
        }

        // 패키지 노드는 연결 포인트 비활성화
        if (typeReg.isPackageType?.(typeLower) || typeLower === 'package') {
            try {
                vertex.setConnectable(false);
            } catch (err) {
                log('패키지 셀 설정 실패:', err);
            }
        }

        // hasGraphChildren도 node에 저장 (fold 대상 판단용)
        node._hasChildren = hasGraphChildren;

        // fold 오버레이 부착 (package + compartment가 있는 definition/usage)
        try {
            if (ns.MxGraph.fold?.isFoldTarget?.(node)) {
                ns.MxGraph.fold.attachFoldOverlay(graph, vertex, node);
            }
        } catch (err) {
            log('fold 오버레이 추가 실패:', err);
        }

        return vertex;
    }

    // Export
    ns.MxGraph.factory.createVertex = createVertex;
    ns.MxGraph.factory.normalizeAnnotationBody = normalizeAnnotationBody;

    console.log('[MxVertexBuilder] 모듈 로드 완료');
})();
