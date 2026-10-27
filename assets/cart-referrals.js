// Coupon state is deliberately memory-only. Server owns eligibility and all totals.
(() => {
  let enabled = false,
    coupon = "",
    revision = 0;
  const box = document.getElementById("couponBox"),
    note = document.getElementById("couponStatus");
  const originalRender = renderCart,
    originalCheckout = checkoutWhatsApp,
    originalBuy = buyNow;
  const moneyCents = (n) => money(n / 100);
  async function request(action, items) {
    const r = await fetch("/api/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, items, coupon }),
    });
    const b = await r.json();
    if (!r.ok) throw Error(b.error || "Não foi possível validar o pedido.");
    return b;
  }
  function totals(q) {
    document.getElementById("cartTotal").textContent = moneyCents(q.subtotal);
    document.getElementById("cartDiscount").textContent = moneyCents(
      q.discount,
    );
    document.getElementById("cartFinal").textContent = moneyCents(q.total);
  }
  async function refresh() {
    const version = ++revision;
    originalRender();
    if (!enabled) return;
    document.getElementById("cartDiscount").textContent = "—";
    document.getElementById("cartFinal").textContent = "Validando…";
    if (!cart.length) {
      totals({ subtotal: 0, discount: 0, total: 0 });
      return;
    }
    try {
      const q = await request("quote", cart);
      if (version === revision) {
        totals(q);
        note.textContent = coupon ? "Cupom validado para esta sacola." : "";
      }
    } catch (e) {
      if (version === revision) {
        note.textContent = e.message;
        document.getElementById("cartFinal").textContent =
          "Aguardando validação";
      }
    }
  }
  renderCart = () => {
    void refresh();
  };
  document.getElementById("applyCoupon").onclick = () => {
    coupon = document.getElementById("couponInput").value.trim().toUpperCase();
    void refresh();
  };
  async function checkout(items) {
    if (!items.length) {
      alert("Sua sacola está vazia.");
      return;
    }
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const q = await request("checkout", items);
      totals(q);
      note.textContent =
        "Pedido validado. Reserva de 30 minutos; frete a confirmar.";
      const href = waLink(q.message);
      if (tab) tab.location.href = href;
      else {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = "Abrir pedido validado no WhatsApp";
        a.target = "_blank";
        a.rel = "noopener";
        note.replaceChildren(a);
      }
    } catch (e) {
      tab?.close();
      note.textContent = e.message;
      alert(e.message);
    }
  }
  checkoutWhatsApp = () => (enabled ? void checkout(cart) : originalCheckout());
  buyNow = () =>
    enabled
      ? void checkout([
          {
            id: currentProduct.id,
            variantIndex: currentVariantIndex,
            size: selectedSize,
            qty: currentQty,
          },
        ])
      : originalBuy();
  const menu = document.getElementById("siteNav");
  const menuButton = document.querySelector(".mobile-menu");
  const closeMenu = () => {
    menu.classList.remove("mobile-open");
    menuButton.setAttribute("aria-expanded", "false");
  };
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
  fetch("/api/referral", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw Error("Campanha indisponível");
      return r.json();
    })
    .then((c) => {
      enabled = c.enabled === true;
      box.hidden = !enabled;
      document.getElementById("validatedTotals").hidden = !enabled;
      document.getElementById("referralPromo").hidden = !enabled;
      document.getElementById("referralNavLink").hidden = !enabled;
      if (enabled) void refresh();
    })
    .catch(() => {});
})();
