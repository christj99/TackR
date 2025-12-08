import React from "react";

export function Sidebar({ activePage, onNavigate, pages, cartCount }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>TackR</h1>
        <div className="sidebar-subtitle">Web insight tracker</div>
      </div>

      <nav className="sidebar-nav">
        {Object.entries(pages).map(([key, label]) => {
          const isCart = key === "cart";

          return (
            <button
              key={key}
              className={
                "nav-item" + (activePage === key ? " nav-item-active" : "")
              }
              onClick={() => onNavigate(key)}
            >
              <span>{label}</span>
              {isCart && cartCount > 0 && (
                <span className="cart-badge">{cartCount}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
