import React, { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar.jsx";
import { Layout } from "./components/Layout.jsx";

import { Boards } from "./pages/Boards.jsx";
import { ForYou } from "./pages/ForYou.jsx";
import { Discover } from "./pages/Discover.jsx";
import { Cart } from "./pages/Cart.jsx";
import { Checkout } from "./pages/Checkout.jsx";
import { PromptTrack } from "./pages/PromptTrack.jsx";

// ⬇️ Add this:
import { api } from "./api/client";


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
  const [cartCount, setCartCount] = useState(0);

    async function refreshCartCount() {
    try {
      // GET /cart returns a list of carts with cartItems
      const carts = await api.get("/cart");
      if (!carts || carts.length === 0) {
        setCartCount(0);
        return;
      }

      // Use the most recently created cart (last in the array)
      const latest = carts[carts.length - 1];

      const totalItems = (latest.cartItems || []).reduce(
        (sum, ci) => sum + (ci.quantity ?? 0),
        0
      );

      setCartCount(totalItems);
    } catch (e) {
      console.error("Failed to refresh cart count:", e);
      // Don't blow up the UI if cart fetch fails
      setCartCount(0);
    }
  }

  const handleCartUpdated = () => {
      refreshCartCount();     // refreshes instantly
    };

    function renderPage() {
    switch (page) {
      case "boards":
        return <Boards onCartUpdated={handleCartUpdated} />;
      case "discover":
        return <Discover onCartUpdated={handleCartUpdated} />;
      case "foryou":
        return <ForYou onCartUpdated={handleCartUpdated} />;
      case "cart":
        return <Cart onCartUpdated={handleCartUpdated} />;
      case "checkout":
        return <Checkout onCartUpdated={handleCartUpdated} />;
      case "prompttrack":
        return <PromptTrack onCartUpdated={handleCartUpdated} />;
      default:
        return <Boards onCartUpdated={handleCartUpdated} />;
    }
  }
  

    useEffect(() => {
    refreshCartCount();
  }, []);


  return (
    <div className="app-root">
      <Sidebar
        activePage={page}
        onNavigate={(p) => {
          setPage(p);
          if (p !== "boards") setSelectedBoardId(null);
          // optional: refresh cart count on navigation
          refreshCartCount();
        }}
        pages={PAGES}
        cartCount={cartCount}
      />
      <Layout>{renderPage()}</Layout>
    </div>
  );
}

