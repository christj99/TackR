import React from "react";

export function Sidebar({ activePage, onNavigate, pages }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>TackR</h1>
        <div className="sidebar-subtitle">Web insight tracker</div>
      </div>

      <nav className="sidebar-nav">
        {Object.entries(pages).map(([key, label]) => (
          <button
            key={key}
            className={
              "nav-item" + (activePage === key ? " nav-item-active" : "")
            }
            onClick={() => onNavigate(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
