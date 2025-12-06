import React, { useState } from "react";
import { Sidebar } from "./components/Sidebar.jsx";
import { Layout } from "./components/Layout.jsx";

import { Boards } from "./pages/Boards.jsx";
import { ForYou } from "./pages/ForYou.jsx";
import { Discover } from "./pages/Discover.jsx";
import { Cart } from "./pages/Cart.jsx";
import { Checkout } from "./pages/Checkout.jsx";
import { PromptTrack } from "./pages/PromptTrack.jsx";

const PAGES = {
  boards: "Boards",
  forYou: "For You",
  discover: "Discover",
  cart: "Cart",
  checkout: "Checkout",
  promptTrack: "Track via Prompt"
};

export default function App() {
  const [page, setPage] = useState("boards");
  const [selectedBoardId, setSelectedBoardId] = useState(null);

  const renderPage = () => {
    switch (page) {
      case "boards":
        return (
          <Boards
            selectedBoardId={selectedBoardId}
            onSelectBoard={setSelectedBoardId}
          />
        );
      case "forYou":
        return <ForYou />;
      case "discover":
        return <Discover />;
      case "cart":
        return <Cart />;
      case "checkout":
        return <Checkout />;
      case "promptTrack":
        return <PromptTrack />;
      default:
        return <Boards />;
    }
  };

  return (
    <div className="app-root">
      <Sidebar
        activePage={page}
        onNavigate={(p) => {
          setPage(p);
          if (p !== "boards") setSelectedBoardId(null);
        }}
        pages={PAGES}
      />
      <Layout>{renderPage()}</Layout>
    </div>
  );
}
