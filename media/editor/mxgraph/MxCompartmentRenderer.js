/* ********************************************************************************
 * Copyright: SELab.AI (c) 2026
 * MxCompartmentRenderer.js - mxGraph Compartment 렌더링
 * Compartment 항목을 개별 mxCell 자식으로 렌더링 (클릭/선택 가능)
 * Loop body 렌더링은 MxLoopBodyRenderer.js에서 담당
 *
 * 의존 모듈:
 * - MxCompartmentHtml.js: HTML 빌드 유틸리티
 * ********************************************************************************/
(function () {
    'use strict';

    const ns = (window.SELAB = window.SELAB || {});
    ns.MxGraph = ns.MxGraph || {};
    ns.MxGraph.compartment = ns.MxGraph.compartment || {};

    // HTML 유틸 모듈 참조
    function getHtmlUtils() {
        return ns.MxGraph.compartmentHtml || {};
    }

    /**
     * Compartment key → SysML 항목 타입 매핑
     */
    const COMPARTMENT_KEY_TO_TYPE = {
        'attributes': 'AttributeUsage',
        'references': 'ReferenceUsage',
        'parts': 'PartUsage',
        'items': 'ItemUsage',
        'ports': 'PortUsage',
        'enumeratedValue': 'EnumerationUsage',
        'enumeratedValues': 'EnumerationUsage',
        'constraints': 'ConstraintUsage',
        'doc': 'Documentation',
        'ends': 'EndFeatureMembership',
        'connections': 'ConnectionUsage',
        'interfaces': 'InterfaceUsage',
        'perform actions': 'PerformActionUsage',
        'performActions': 'PerformActionUsage',
        'metadata': 'MetadataUsage',
        'performed by': 'PerformActionUsage',
        'for iterator': 'ForLoopActionUsage',
        'loop body': 'ActionUsage',
        'concern': 'ConcernUsage',
        'stakeholder': 'StakeholderMembership',
        'subject': 'SubjectMembership',
        'objective': 'ObjectiveMembership',
        'occurrences': 'OccurrenceUsage',
        'successions': 'SuccessionAsUsage',
        'nestedPort': 'PortUsage',
        'nestedAttribute': 'AttributeUsage',
        'nestedInterface': 'InterfaceUsage',
        'parameters': 'ReferenceUsage',
        'actionFlow': 'ActionUsage',
    };

    /**
     * Compartment를 mxGraph 자식 셀로 렌더링합니다.
     * @param {mxGraph} graph - mxGraph 인스턴스
     * @param {mxCell} vertex - 부모 셀
     * @param {Array} compartments - compartment 배열
     * @param {Object} options - 옵션 (hasGraphChildren 등)
     * @returns {Object} 생성된 셀 맵 (id -> cell)
     */
    function createCompartmentCells(graph, vertex, compartments, options = {}) {
        if (!compartments || compartments.length === 0) {
            return {};
        }

        const htmlUtils = getHtmlUtils();
        const formatCompartmentItem = htmlUtils.formatCompartmentItem || function(item) { return String(item); };
        const cellMap = {};

        // 테마에 따른 텍스트 색상
        const isDark = ns.MxGraph.styleColors?.isDarkTheme?.() || false;
        const fontColor = isDark ? '#e0e0e0' : '#333333';
        const hrColor = isDark ? '#555555' : '#888888';

        try {
            const isActionFlowKey = (key) => key === 'action flow' || key === 'actionFlow';
            const actionFlowComp = compartments.find(c => isActionFlowKey(c.key));
            const hasActionFlowNodes = actionFlowComp && Array.isArray(actionFlowComp.items) && actionFlowComp.items.length > 0;
            const hasGraphChildren = !!options.hasGraphChildren;
            const showSeparator = hasActionFlowNodes || hasGraphChildren;
            // block editor에서 references compartment는 표시하지 않음 (allocation 등은 엣지로 표시)
            const visibleCompartments = compartments.filter(c => c.key !== 'references');

            if (visibleCompartments.length === 0 || visibleCompartments.every(c => (!c.items || c.items.length === 0) && c.headerOnly !== true)) {
                return {};
            }

            const DS = window.SELAB?.Editor?.config?.displaySettings;
            const HR_HEIGHT = DS?.compartment?.separatorHeight ?? 9;
            const HEADER_HEIGHT = DS?.compartment?.headerHeight ?? 20;
            const HEADER_PADDING = DS?.compartment?.headerPadding ?? 2;
            const ITEM_HEIGHT = DS?.compartment?.itemHeight ?? 16;

            const parentGeo = vertex.getGeometry();
            const parentWidth = parentGeo.width;
            const metrics = ns.Editor?.metrics;
            const nodeData = vertex._nodeData;
            
            let labelHeight = 30;
            if (nodeData?._wrappedStereotype || nodeData?._wrappedName) {
                const stereotypeLines = nodeData._wrappedStereotype?.length || 0;
                const nameLines = nodeData._wrappedName?.length || 0;
                const totalLines = stereotypeLines + nameLines;
                const lineHeight = DS?.label?.lineHeight ?? 14;
                const paddingVertical = DS?.label?.paddingVertical ?? 16;
                labelHeight = totalLines * lineHeight + paddingVertical;
            } else {
                // [FIX] nodeData.name만으로 계산하면 실제로 렌더링되는 «stereotype» 줄이 빠져서
                // labelHeight가 실제 제목 높이보다 작게 잡히고, 그 결과 ports 등 compartment
                // 섹션이 제목 2번째 줄(이름)과 겹치는 버그가 있었음(_wrappedStereotype/_wrappedName
                // 캐시가 비어있는 노드에서 발생). vertex에 실제로 설정된 라벨 값(줄바꿈 포함)을
                // 그대로 사용해 정확한 줄 수를 계산한다.
                const actualLabel = typeof vertex.value === 'string' ? vertex.value : (nodeData?.name || '');
                labelHeight = metrics?.calculateLabelHeight
                    ? metrics.calculateLabelHeight(actualLabel)
                    : 30;
            }

            let y = labelHeight;
            let totalCompHeight = 0;

            let lastRenderIndex = -1;
            for (let i = visibleCompartments.length - 1; i >= 0; i--) {
                const c = visibleCompartments[i];
                const hasItems = c.items && c.items.length > 0;
                if (hasItems || isActionFlowKey(c.key) || c.headerOnly === true) {
                    lastRenderIndex = i;
                    break;
                }
            }

            graph.getModel().beginUpdate();
            try {
                for (let i = 0; i < visibleCompartments.length; i++) {
                    const comp = visibleCompartments[i];
                    const key = comp.key || 'compartment';
                    const items = Array.isArray(comp.items) ? comp.items : [];
                    const isHeaderOnly = comp.headerOnly === true;

                    if (isActionFlowKey(key)) {
                        const hrCellAf = graph.insertVertex(
                            vertex, null, '',
                            0, y, parentWidth, HR_HEIGHT,
                            'selectable=0;movable=0;resizable=0;connectable=0;' +
                            'fillColor=none;strokeColor=none;html=1;overflow=fill;'
                        );
                        hrCellAf.setValue(`<div style="margin:4px 0;border-top:1px solid ${hrColor};"></div>`);
                        y += HR_HEIGHT;
                        totalCompHeight += HR_HEIGHT;
                        const afLabel = ns.Editor?.config?.compartmentLabels?.actionFlow ?? 'action flow';
                        graph.insertVertex(
                            vertex, null, afLabel,
                            0, y, parentWidth, HEADER_HEIGHT + HEADER_PADDING,
                            'selectable=0;movable=0;resizable=0;connectable=0;' +
                            `fillColor=none;strokeColor=none;fontStyle=1;fontColor=${fontColor};` +
                            'align=left;spacingLeft=6;fontSize=11;verticalAlign=top;'
                        );
                        y += HEADER_HEIGHT + HEADER_PADDING;
                        totalCompHeight += HEADER_HEIGHT + HEADER_PADDING;
                        continue;
                    }

                    if (items.length === 0 && !isHeaderOnly) continue;

                    const hrCell = graph.insertVertex(
                        vertex, null, '',
                        0, y, parentWidth, HR_HEIGHT,
                        'selectable=0;movable=0;resizable=0;connectable=0;' +
                        'fillColor=none;strokeColor=none;html=1;overflow=fill;'
                    );
                    hrCell.setValue(`<div style="margin:4px 0;border-top:1px solid ${hrColor};"></div>`);
                    y += HR_HEIGHT;
                    totalCompHeight += HR_HEIGHT;

                    const headerH = HEADER_HEIGHT + HEADER_PADDING;
                    graph.insertVertex(
                        vertex, null, key,
                        0, y, parentWidth, headerH,
                        'selectable=0;movable=0;resizable=0;connectable=0;' +
                        `fillColor=none;strokeColor=none;fontStyle=1;fontColor=${fontColor};` +
                        'align=left;spacingLeft=6;fontSize=11;verticalAlign=top;'
                    );
                    y += headerH;
                    totalCompHeight += headerH;

                    if (isHeaderOnly) {
                        if (i === lastRenderIndex && showSeparator) {
                            const trailHrCell = graph.insertVertex(
                                vertex, null, '',
                                0, y, parentWidth, HR_HEIGHT,
                                'selectable=0;movable=0;resizable=0;connectable=0;' +
                                'fillColor=none;strokeColor=none;html=1;overflow=fill;'
                            );
                            trailHrCell.setValue(`<div style="margin:4px 0;border-top:1px solid ${hrColor};"></div>`);
                            y += HR_HEIGHT;
                            totalCompHeight += HR_HEIGHT;
                        }
                        continue;
                    }

                    for (let j = 0; j < items.length; j++) {
                        const item = items[j];
                        const isSpecialComp = (key === 'doc' || key === 'constraints');

                        let itemH = ITEM_HEIGHT;
                        let itemLabel = '';

                        if (isSpecialComp && typeof item === 'object') {
                            if (key === 'constraints' && item.keyword) {
                                const rawBody = (item.body || item.name || '');
                                const cleanBody = rawBody.replace(/\r\n/g, '\n').replace(/\t+/g, '    ');
                                const bodyLines = cleanBody.split('\n').map(l => l.trim()).filter(Boolean);
                                itemLabel = item.keyword + ' {\n' + bodyLines.map(l => '    ' + l).join('\n') + '\n}';
                                const CHARS_PER_LINE = 25;
                                let wrapLines = 0;
                                for (const line of bodyLines) {
                                    wrapLines += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE));
                                }
                                itemH = (wrapLines + 2) * ITEM_HEIGHT;
                            } else if (key === 'constraints' && item.body) {
                                const rawBody = (item.body || '');
                                const cleanBody = rawBody.replace(/\r\n/g, '\n').replace(/\t+/g, '    ');
                                const bodyLines = cleanBody.split('\n').map(l => l.trim()).filter(Boolean);
                                itemLabel = bodyLines.join('\n');
                                const CHARS_PER_LINE2 = 25;
                                let wrapLines2 = 0;
                                for (const line of bodyLines) {
                                    wrapLines2 += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE2));
                                }
                                itemH = wrapLines2 * ITEM_HEIGHT;
                            } else {
                                itemLabel = item.body || item.name || '';
                                let linesCount = 1;
                                const compMaxWidth = Math.max(10, parentWidth - 20);
                                if (window.SELAB && window.SELAB.Editor && window.SELAB.Editor.metrics && window.SELAB.Editor.metrics.calculateWrappedLines) {
                                    linesCount = window.SELAB.Editor.metrics.calculateWrappedLines(itemLabel, compMaxWidth);
                                } else {
                                    const rawBody = itemLabel.replace(/\r\n/g, '\n').replace(/\t+/g, '    ');
                                    const bodyLines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);
                                    let wrapLines = 0;
                                    for (const line of bodyLines) {
                                        wrapLines += Math.max(1, Math.ceil(line.length / 30));
                                    }
                                    linesCount = wrapLines > 0 ? wrapLines : 1;
                                }
                                itemH = linesCount * ITEM_HEIGHT;
                            }
                        } else {
                            itemLabel = (typeof item === 'object' && item.label)
                                ? item.label
                                : formatCompartmentItem(item);
                        }

                        const itemId = (typeof item === 'object' && item.id)
                            ? item.id
                            : null;

                        const itemCell = graph.insertVertex(
                            vertex, itemId, itemLabel,
                            0, y, parentWidth, itemH,
                            'movable=0;resizable=0;connectable=0;' +
                            `fillColor=none;strokeColor=none;fontColor=${fontColor};` +
                            'align=left;spacingLeft=14;fontSize=11;verticalAlign=top;' +
                            'whiteSpace=wrap;overflow=hidden;'
                        );

                        const itemType = COMPARTMENT_KEY_TO_TYPE[key] || '';

                        if (typeof item === 'object') {
                            if (!item.type && !item.kind) {
                                item.type = itemType;
                            }
                            item.parentId = item.parentId || nodeData?.id;
                            item.parentName = item.parentName || nodeData?.name;
                            item.compartmentKey = key;
                            itemCell._nodeData = item;
                        } else {
                            itemCell._nodeData = {
                                name: String(item),
                                type: itemType,
                                parentId: nodeData?.id,
                                parentName: nodeData?.name,
                                compartmentKey: key,
                                _isCompartmentItem: true,
                            };
                        }
                        itemCell._isCompartmentItem = true;

                        if (itemId) {
                            cellMap[itemId] = itemCell;
                        }

                        y += itemH;
                        totalCompHeight += itemH;
                    }

                    if (i === lastRenderIndex && showSeparator) {
                        const trailHrCell = graph.insertVertex(
                            vertex, null, '',
                            0, y, parentWidth, HR_HEIGHT,
                            'selectable=0;movable=0;resizable=0;connectable=0;' +
                            'fillColor=none;strokeColor=none;html=1;overflow=fill;'
                        );
                        trailHrCell.setValue(`<div style="margin:4px 0;border-top:1px solid ${hrColor};"></div>`);
                        y += HR_HEIGHT;
                        totalCompHeight += HR_HEIGHT;
                    }
                }
            } finally {
                graph.getModel().endUpdate();
            }

            vertex._textCompartmentHeight = totalCompHeight;

        } catch (e) {
            console.error('[MxCompartmentRenderer] createCompartmentCells 오류:', e);
        }

        return cellMap;
    }

    // Export (하위 호환성 유지)
    ns.MxGraph.compartment.createCompartmentCells = createCompartmentCells;
    
    // HTML 유틸 함수도 하위 호환성을 위해 노출
    ns.MxGraph.compartment.buildCompartmentHtml = function(compartments, showSeparator) {
        const htmlUtils = getHtmlUtils();
        if (typeof htmlUtils.buildCompartmentHtml === 'function') {
            return htmlUtils.buildCompartmentHtml(compartments, showSeparator);
        }
        return { html: '', height: 0 };
    };

    console.log('[MxCompartmentRenderer] 모듈 로드 완료');
})();
