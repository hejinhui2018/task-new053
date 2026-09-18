// 告知 React 当前处于测试环境，启用 act(...) 语义
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
