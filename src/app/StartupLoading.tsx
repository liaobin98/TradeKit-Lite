// 关键样式内联在 index.html 中，让应用脚本到达前也能展示同一加载状态。
export function StartupLoading() {
  return <div className="startup-loading" role="status" aria-live="polite" aria-atomic="true">
    <div className="startup-loading-content">
      <img src="/favicon.svg" width="48" height="48" alt="" />
      <p className="startup-loading-title">正在打开工作台</p>
      <p className="startup-loading-message"><span className="startup-loading-spinner" aria-hidden="true" />正在准备工作台，请稍候…</p>
    </div>
  </div>;
}
