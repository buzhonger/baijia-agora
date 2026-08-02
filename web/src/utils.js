// 全局共享工具函数。

// 去掉 label 里的括号补充说明（如"（有免费模型）""(阿里)"），显示更整洁。
// 供应商名字在多处显示，统一走这个函数，避免各处不一致。
export function cleanLabel(label = '') {
  return String(label).replace(/（[^）]*）|\([^)]*\)/g, '').trim();
}
