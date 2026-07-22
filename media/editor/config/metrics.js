/* ********************************************************************************
 * Copyright: SELab.AI (c) 2026
 *
 * 공통 메트릭 및 높이 계산 유틸리티
 * SVG 렌더러와 mxGraph 렌더러 간 일관성을 보장하기 위한 중앙화된 상수 및 함수
 * 모든 숫자 상수는 displaySettings.js에서 가져옴 (Single Source of Truth)
 * ********************************************************************************/
(function () {
    const ns = (window.SELAB = window.SELAB || {});
    ns.Editor = ns.Editor || {};
    ns.Editor.metrics = ns.Editor.metrics || {};

    // displaySettings에서 값을 가져오는 헬퍼
    const DS = ns.Editor.config?.displaySettings;
    if (!DS) {
        console.warn('[metrics] displaySettings가 아직 로드되지 않았습니다.');
    }

    /**
     * 레이블 메트릭 (mxGraph 실제 렌더링에 맞춤)
     * @see displaySettings.label
     */
    const LABEL_METRICS = {
        LINE_HEIGHT: DS?.label?.lineHeight ?? 14,
        PADDING_VERTICAL: DS?.label?.paddingVertical ?? 16,
        MIN_HEIGHT: DS?.label?.minHeight ?? 30,
    };

    /**
     * Compartment 메트릭 (mxGraph 실제 렌더링 값과 일치)
     * @see displaySettings.compartment
     */
    const COMPARTMENT_METRICS = {
        SEPARATOR_HEIGHT: DS?.compartment?.separatorHeight ?? 9,
        HEADER_HEIGHT: DS?.compartment?.headerHeight ?? 20,
        HEADER_PADDING: DS?.compartment?.headerPadding ?? 2,
        ITEM_HEIGHT: DS?.compartment?.itemHeight ?? 16,
        MARGIN: DS?.compartment?.margin ?? 8,
    };

    /**
     * 컨테이너 메트릭
     * @see displaySettings.container
     */
    const CONTAINER_METRICS = {
        PADDING_RIGHT: DS?.container?.paddingRight ?? 16,
        PADDING_BOTTOM: DS?.container?.paddingBottom ?? 16,
        MIN_WIDTH: DS?.container?.minWidth ?? 120,
    };

    /**
     * Border Node 메트릭
     * @see displaySettings.borderNode
     */
    const BORDER_NODE_METRICS = {
        SIZE: DS?.borderNode?.size ?? 12,
    };

    /**
     * FreeForm Compartment 메트릭 (action flow, parts 등)
     * @see displaySettings.freeform
     */
    const FREEFORM_METRICS = {
        // SVG 렌더러용
        NODE_WIDTH: DS?.freeform?.nodeWidth ?? 120,
        NODE_HEIGHT: DS?.freeform?.nodeHeight ?? 40,
        ACTION_FLOW_SPACING: DS?.freeform?.actionFlowSpacing ?? 50,
        PARTS_SPACING: DS?.freeform?.partsSpacing ?? 8,
        START_X_OFFSET: DS?.freeform?.startXOffset ?? 20,
        
        // mxGraph 렌더러용
        MX_ACTION_FLOW_GAP: DS?.freeform?.mxActionFlowGap ?? 20,
        MX_PARTS_GAP: DS?.freeform?.mxPartsGap ?? 8,
        MX_CIRCLE_SIZE: DS?.freeform?.mxCircleSize ?? 16,
        MX_HEADER_HEIGHT: DS?.freeform?.mxHeaderHeight ?? 18,
        
        // 공통
        LINE_HEIGHT: DS?.freeform?.lineHeight ?? 14,
        BOTTOM_PADDING: DS?.freeform?.bottomPadding ?? 4,
    };

    /**
     * 텍스트 라인 수 계산
     * @param {string} text - 텍스트
     * @returns {number} 라인 수
     */
    function countTextLines(text) {
        if (!text) return 1;
        const str = String(text);

        // [FIX] MxLabelUtils.js의 formatLabel()은 스테레오타입을 '\n'이 아니라
        // `<div>«part def»</div>이름` 형태의 HTML로 감싸서 반환함. 그래서 '\n' 기준으로만
        // 세면 항상 1줄로 잡혀 labelHeight가 실제보다 작게 계산되고, ports 등 compartment
        // 섹션이 제목 2번째 줄(이름)과 겹치는 버그로 이어졌음.
        // <div>...</div> 블록은 한 줄로 세고, 그 뒤에 남는 텍스트(이름)가 있으면 추가로 세어준다.
        const divMatches = str.match(/<div[^>]*>[\s\S]*?<\/div>/g);
        if (divMatches && divMatches.length > 0) {
            const remainder = str.replace(/<div[^>]*>[\s\S]*?<\/div>/g, '').trim();
            const remainderLines = remainder ? remainder.split('\n').filter(Boolean).length : 0;
            return divMatches.length + remainderLines || 1;
        }

        const lines = str.split('\n').filter(Boolean);
        return lines.length || 1;
    }

    /**
     * 라벨 높이 계산 (노드의 베이스 라벨 영역)
     * @param {string} label - 라벨 텍스트
     * @returns {number} 계산된 높이 (픽셀)
     */
    function calculateLabelHeight(label) {
        const lines = countTextLines(label);
        const height = lines * LABEL_METRICS.LINE_HEIGHT + LABEL_METRICS.PADDING_VERTICAL;
        return Math.max(LABEL_METRICS.MIN_HEIGHT, height);
    }

    /**
     * 텍스트 너비 측정 (Canvas API 사용)
     */
    function measureTextWidth(text, font = '11px Arial') {
        if (!text) return 0;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = font;
        return ctx.measureText(text).width;
    }

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
                // 한 글자씩 너비를 누적하여 줄바꿈 계산 (CJK 글자 등 공백 없는 긴 문자열 자동 줄바꿈 대응)
                let currentLineWidth = 0;
                let wrappedLineCount = 1;
                
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    // 영문/공백 등은 어림잡기보다 약간 보수적으로 직접 측정
                    const charWidth = measureTextWidth(char);
                    
                    if (currentLineWidth + charWidth > maxTextWidth && currentLineWidth > 0) {
                        // 현재 줄 폭을 초과하면 개행
                        wrappedLineCount++;
                        currentLineWidth = charWidth;
                    } else {
                        currentLineWidth += charWidth;
                    }
                }
                
                totalLines += wrappedLineCount;
            }
        }
        
        return totalLines;
    }

    /**
     * Compartment 높이 계산
     * @param {Object} compartment - Compartment 객체
     * @param {boolean} includeEmpty - 빈 compartment도 높이를 계산할지 여부
     * @param {number} nodeWidth - 노드의 실제 폭 (줄바꿈 계산용)
     * @returns {number} 계산된 높이 (픽셀)
     */
    function calculateCompartmentHeight(compartment, includeEmpty = false, nodeWidth = 200) {
        if (!compartment) return 0;

        const items = Array.isArray(compartment.items) ? compartment.items : [];
        const isActionFlow = compartment.layout === 'freeform' || compartment.key === 'action flow' || compartment.key === 'perform actions';
        const isHeaderOnly = compartment.headerOnly === true;

        if (isHeaderOnly) {
            return COMPARTMENT_METRICS.SEPARATOR_HEIGHT +
                COMPARTMENT_METRICS.HEADER_HEIGHT +
                COMPARTMENT_METRICS.HEADER_PADDING;
        }

        if (items.length === 0) {
            return includeEmpty ? COMPARTMENT_METRICS.HEADER_HEIGHT : 0;
        }

        if (isActionFlow) {
            return calculateActionFlowHeight(items);
        }

        // mxGraph 실제 렌더링과 일치: 구분선 + 헤더 + 패딩 + 항목들
        let totalHeight = COMPARTMENT_METRICS.SEPARATOR_HEIGHT;  // 구분선
        totalHeight += COMPARTMENT_METRICS.HEADER_HEIGHT;        // 헤더
        totalHeight += COMPARTMENT_METRICS.HEADER_PADDING;       // 헤더 패딩
        
        // 각 아이템의 실제 줄바꿈 계산 (ELK 로직 적용)
        // 실제 노드 폭을 사용하여 패딩 제외한 텍스트 영역 계산
        const padding = DS?.compartment?.textPadding ?? 16;
        const maxTextWidth = nodeWidth - padding;
        
        for (const item of items) {
            if (typeof item === 'object' && item.keyword && item.body) {
                // constraint item: "keyword {" (1줄) + body lines + "}" (1줄)
                const rawBody = (item.body || '').replace(/\r\n/g, '\n').replace(/\t+/g, '    ');
                const bodyLines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);
                let wrapLines = 0;
                for (const line of bodyLines) {
                    wrapLines += calculateWrappedLines(line, maxTextWidth);
                }
                // keyword 1줄 + body wrap 줄 수 + 닫는 중괄호 1줄
                totalHeight += (wrapLines + 2) * COMPARTMENT_METRICS.ITEM_HEIGHT;
            } else {
                const itemText = typeof item === 'string' ? item : (item.body || item.label || item.name || '');
                const lines = calculateWrappedLines(itemText, maxTextWidth);
                totalHeight += lines * COMPARTMENT_METRICS.ITEM_HEIGHT;
            }
        }
        
        return totalHeight;
    }
    
    /**
     * Border Nodes 높이 계산
     * 상단/하단 포트의 라벨 영역만 높이에 포함
     * @param {Array} borderNodes - Border Node 배열
     * @returns {number} 계산된 높이 (픽셀)
     */
    function calculateBorderNodesHeight(borderNodes) {
        // [FIX] 기존에는 항상 0을 반환했음 -> E/W측 보더노드가 있는(포트만 있고 compartment는 없는)
        // 컴팩트한 컨테이너(RenderEngine, LoadBalancer, SmartMeter 등)에서 포트끼리 또는 포트와
        // 제목 라벨이 겹치는 버그의 원인 중 하나였음.
        // 제목 라벨과의 겹침 자체는 MxEdgeBuilder.js createBorderNode()가 headerClearance를
        // 별도로 확보하도록 고쳤으므로(그쪽 [FIX] 참고), 여기서는 같은 side에 여러 포트가
        // 세로로 쌓일 때 서로 겹치지 않도록 여유 공간만 계산한다.
        // (layout.js 3a의 N/S측 폭 계산과 대칭되는 E/W측 높이 버전)
        if (!Array.isArray(borderNodes) || borderNodes.length === 0) return 0;

        const BN = DS?.borderNode;
        const bnSize = BN?.size ?? 12;
        const bnMinSpacing = BN?.minSpacing ?? 16;
        const bnSideMargin = BN?.sideMargin ?? 16;

        const sideCounts = {};
        let hasNS = false;
        for (const bn of borderNodes) {
            const side = String(bn.side || 'E').toUpperCase();
            if (side === 'E' || side === 'W') {
                sideCounts[side] = (sideCounts[side] || 0) + 1;
            } else if (side === 'N' || side === 'S') {
                hasNS = true;
            }
        }
        const maxEWCount = Object.values(sideCounts).reduce((m, c) => Math.max(m, c), 0);

        let ewExtra = 0;
        if (maxEWCount > 0) {
            ewExtra = maxEWCount * (bnSize + bnMinSpacing) - bnMinSpacing + 2 * bnSideMargin;
        }

        // [FIX] N측 포트(direction='in'/'inout'인 경우 자동 배정)는 MxEdgeBuilder.js에서
        // headerClearance만큼 아래로 밀어서 배치하므로, 포트 자신 + 라벨 한 줄이 박스 안에
        // 들어갈 여유 공간을 별도로 확보해야 함 (안 그러면 라벨이 박스 바깥으로 삐져나감).
        let nsExtra = 0;
        if (hasNS) {
            const spTop = BN?.spacingTop ?? 2;
            const spBot = BN?.spacingBottom ?? 2;
            nsExtra = bnSize + spTop + spBot + LABEL_METRICS.LINE_HEIGHT + 8;
        }

        return Math.max(ewExtra, nsExtra);
    }

    /**
     * Action Flow Compartment 높이 계산
     * @param {Array} items - action flow items 배열
     * @returns {number} 계산된 높이 (픽셀)
     */
    function calculateActionFlowHeight(items) {
        const headerHeight = DS?.freeform?.mxHeaderHeight ?? 18;
        const itemGap = DS?.compartment?.itemHeight ?? 16;
        const circleSize = DS?.freeform?.mxCircleSize ?? 16;
        
        let totalHeight = headerHeight;
        
        items.forEach((item, idx) => {
            const itemKind = typeof item === 'object' ? (item.kind || '') : '';
            const itemRole = typeof item === 'object' ? (item.role || '') : '';
            const isLast = idx === items.length - 1;
            const gap = isLast ? 0 : itemGap;  // 마지막 아이템은 gap 없음
            
            if (itemRole === 'initial' || itemKind === 'StartAction') {
                totalHeight += circleSize + gap;
            } else if (itemRole === 'final' || itemKind === 'DoneAction') {
                totalHeight += (circleSize + 6) + gap;  // outerSize
            } else if (itemKind === 'AssignmentActionUsage') {
                totalHeight += 40 + gap;
            } else if (itemKind === 'WhileLoopActionUsage' || itemKind === 'ForLoopActionUsage') {
                const guard = typeof item === 'object' ? (item.guard || '') : '';
                const body = typeof item === 'object' ? (item.body || '') : '';
                let loopLabel = `«loop»\n${item.name || ''}`;
                if (guard) loopLabel += `\n─────────────\nwhile ${guard}`;
                if (body) loopLabel += `\n─────────────\n${body}`;
                const lineCount = loopLabel.split('\n').length;
                totalHeight += Math.max(50, lineCount * 14 + 16) + gap;
            } else {
                totalHeight += 30 + gap;
            }
        });
        
        totalHeight += 8;  // 하단 여백 (최소화)
        return totalHeight;
    }

    /**
     * 모든 compartment의 총 높이 계산
     * @param {Array} compartments - Compartment 배열
     * @param {boolean} includeEmpty - 빈 compartment도 포함할지 여부
     * @param {number} nodeWidth - 노드의 실제 폭 (줄바꿈 계산용)
     * @returns {number} 총 높이 (픽셀)
     */
    function calculateTotalCompartmentsHeight(compartments, includeEmpty = false, nodeWidth = 200) {
        if (!Array.isArray(compartments)) return 0;

        return compartments.reduce((sum, comp) => {
            return sum + calculateCompartmentHeight(comp, includeEmpty, nodeWidth);
        }, 0);
    }

    /**
     * 노드의 전체 높이 계산 (라벨 + compartments + borderNodes)
     * @param {string} label - 노드 라벨
     * @param {Array} compartments - Compartment 배열
     * @param {boolean} includeEmpty - 빈 compartment도 포함할지 여부
     * @param {number} nodeWidth - 노드의 실제 폭 (줄바꿈 계산용)
     * @param {Array} borderNodes - Border Node 배열
     * @returns {number} 총 높이 (픽셀)
     */
    function calculateTotalNodeHeight(label, compartments, includeEmpty = false, nodeWidth = 200, borderNodes = []) {
        const labelHeight = calculateLabelHeight(label);
        const compartmentsHeight = calculateTotalCompartmentsHeight(compartments, includeEmpty, nodeWidth);
        const borderNodesHeight = calculateBorderNodesHeight(borderNodes);
        const margin = compartmentsHeight > 0 ? COMPARTMENT_METRICS.MARGIN : 0;

        return labelHeight + compartmentsHeight + borderNodesHeight + margin;
    }

    /**
     * 컨테이너 노드가 자식들을 포함하는데 필요한 최소 높이 계산
     * @param {Object} container - 컨테이너 요소
     * @param {Array} children - 자식 요소 배열
     * @returns {number} 필요한 최소 높이
     */
    function calculateContainerMinHeight(container, children) {
        if (!container || !Array.isArray(children) || children.length === 0) {
            return container?.height || LABEL_METRICS.MIN_HEIGHT;
        }

        const containerY = Number(container.y || 0);
        let bottomMost = containerY + (Number(container.height) || LABEL_METRICS.MIN_HEIGHT);

        for (const child of children) {
            const childBottom = Number(child.y || 0) + Number(child.height || 0);
            const adjustedBottom = childBottom + CONTAINER_METRICS.PADDING_BOTTOM;

            if (adjustedBottom > bottomMost) {
                bottomMost = adjustedBottom;
            }
        }

        return bottomMost - containerY;
    }

    /**
     * 컨테이너 노드가 자식들을 포함하는데 필요한 최소 너비 계산
     * @param {Object} container - 컨테이너 요소
     * @param {Array} children - 자식 요소 배열
     * @returns {number} 필요한 최소 너비
     */
    function calculateContainerMinWidth(container, children) {
        if (!container || !Array.isArray(children) || children.length === 0) {
            return container?.width || CONTAINER_METRICS.MIN_WIDTH;
        }

        const containerX = Number(container.x || 0);
        let rightMost = containerX + (Number(container.width) || CONTAINER_METRICS.MIN_WIDTH);

        for (const child of children) {
            const childRight = Number(child.x || 0) + Number(child.width || 0);
            const adjustedRight = childRight + CONTAINER_METRICS.PADDING_RIGHT;

            if (adjustedRight > rightMost) {
                rightMost = adjustedRight;
            }
        }

        return rightMost - containerX;
    }

    /**
     * 디버그용 높이 계산 정보 출력
     * @param {string} nodeId - 노드 ID
     * @param {string} label - 라벨
     * @param {Array} compartments - Compartments
     */
    function debugHeightCalculation(nodeId, label, compartments) {
        const labelH = calculateLabelHeight(label);
        const compH = calculateTotalCompartmentsHeight(compartments, false);
        const total = calculateTotalNodeHeight(label, compartments, false);

        console.log(`[metrics] Node ${nodeId} height calculation:`, {
            label: label,
            labelHeight: labelH,
            compartments: compartments?.length || 0,
            compartmentsHeight: compH,
            totalHeight: total
        });
    }

    // Export to namespace
    ns.Editor.metrics.LABEL_METRICS = LABEL_METRICS;
    ns.Editor.metrics.COMPARTMENT_METRICS = COMPARTMENT_METRICS;
    ns.Editor.metrics.CONTAINER_METRICS = CONTAINER_METRICS;
    ns.Editor.metrics.BORDER_NODE_METRICS = BORDER_NODE_METRICS;
    ns.Editor.metrics.FREEFORM_METRICS = FREEFORM_METRICS;
    ns.Editor.metrics.countTextLines = countTextLines;
    ns.Editor.metrics.calculateLabelHeight = calculateLabelHeight;
    ns.Editor.metrics.calculateCompartmentHeight = calculateCompartmentHeight;
    ns.Editor.metrics.calculateTotalCompartmentsHeight = calculateTotalCompartmentsHeight;
    ns.Editor.metrics.calculateBorderNodesHeight = calculateBorderNodesHeight;
    ns.Editor.metrics.calculateTotalNodeHeight = calculateTotalNodeHeight;
    ns.Editor.metrics.calculateContainerMinHeight = calculateContainerMinHeight;
    ns.Editor.metrics.calculateContainerMinWidth = calculateContainerMinWidth;
    ns.Editor.metrics.debugHeightCalculation = debugHeightCalculation;
})();
