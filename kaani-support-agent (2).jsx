import React, { useState, useRef, useEffect } from "react";

/* ---------------------------------------------------------
   Kaani Green — Help Counter
   An AI-powered customer support agent for a houseplant
   e-commerce store. Uses the Claude API with tool-use to
   look up orders, search the catalog, check return
   eligibility, and escalate to a human when needed.
--------------------------------------------------------- */

// ---------- Mock store data ----------

const ORDERS = {
  "KG-1042": {
    id: "KG-1042",
    placed: "2026-08-28",
    delivered: "2026-09-02",
    status: "Delivered",
    items: [{ name: "Monstera Deliciosa, 8in pot", qty: 1, price: 799 }],
    total: 799,
    tracking: "IN-DLV-88213",
    address: "Madurai, Tamil Nadu",
  },
  "KG-1077": {
    id: "KG-1077",
    placed: "2026-09-06",
    delivered: null,
    status: "Shipped",
    items: [
      { name: "Snake Plant, 6in pot", qty: 2, price: 349 },
      { name: "Terracotta Saucer, 6in", qty: 2, price: 99 },
    ],
    total: 896,
    tracking: "IN-TRK-40217",
    address: "Coimbatore, Tamil Nadu",
  },
  "KG-1090": {
    id: "KG-1090",
    placed: "2026-09-10",
    delivered: null,
    status: "Processing",
    items: [{ name: "Areca Palm, 10in pot", qty: 1, price: 1199 }],
    total: 1199,
    tracking: null,
    address: "Chennai, Tamil Nadu",
  },
};

const PRODUCTS = [
  { name: "Monstera Deliciosa", price: 799, light: "Bright, indirect", care: "Easy", water: "Weekly" },
  { name: "Snake Plant", price: 349, light: "Low to bright", care: "Very easy", water: "Every 2–3 weeks" },
  { name: "ZZ Plant", price: 449, light: "Low to bright", care: "Very easy", water: "Every 2–3 weeks" },
  { name: "Peace Lily", price: 549, light: "Medium, indirect", care: "Moderate", water: "Weekly, likes humidity" },
  { name: "Areca Palm", price: 1199, light: "Bright, indirect", care: "Moderate", water: "Twice a week" },
  { name: "Money Plant (Pothos)", price: 249, light: "Low to medium", care: "Very easy", water: "Weekly" },
];

const STORE_POLICY = `
Shipping: Free above ₹999, else ₹99 flat. Dispatch in 2–3 days, delivery in 4–7 days depending on city.
Returns: 15 days from delivery date, plant must be alive and in its original pot. Dead-on-arrival or
damaged plants are replaced free within 48 hours of delivery with photo proof — no return window needed for those.
Payment: UPI, cards, and cash on delivery for orders under ₹2000.
`;

const SYSTEM_PROMPT = `You are the support agent for Kaani Green, an online houseplant store based in Tamil Nadu, India.
You are warm, plain-spoken, and brief — like a knowledgeable person at a nursery counter, not a corporate script.
Prices are in Indian rupees (₹).

Store policy:
${STORE_POLICY}

You have tools to look up real order and product data — always use them instead of guessing when the
customer mentions an order ID, asks about a product, or asks about return eligibility for a specific order.
If you cannot resolve something (damaged item, complaint, anything requiring a human judgment call), use the
create_ticket tool to escalate, and tell the customer plainly what happens next.
Keep replies short — a few sentences. Never invent an order or tracking number.`;

const TOOLS = [
  {
    name: "lookup_order",
    description: "Look up a Kaani Green order by its order ID to get status, items, and tracking info.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string", description: "Order ID, e.g. KG-1042" } },
      required: ["order_id"],
    },
  },
  {
    name: "search_products",
    description: "Search the plant catalog by name or keyword to get price, light needs, and care level.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Product name or keyword" } },
      required: ["query"],
    },
  },
  {
    name: "check_return_eligibility",
    description: "Check whether a specific order is still within the 15-day return window.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string", description: "Order ID, e.g. KG-1042" } },
      required: ["order_id"],
    },
  },
  {
    name: "create_ticket",
    description: "Escalate the conversation to a human support agent when the AI cannot resolve it.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Short summary of the issue" },
        order_id: { type: "string", description: "Related order ID, if any" },
      },
      required: ["reason"],
    },
  },
];

function runTool(name, input) {
  if (name === "lookup_order") {
    const o = ORDERS[input.order_id?.toUpperCase()];
    return o ? o : { error: `No order found with ID ${input.order_id}` };
  }
  if (name === "search_products") {
    const q = (input.query || "").toLowerCase();
    const matches = PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
    return matches.length ? matches : { error: "No matching plants found", catalog: PRODUCTS.map((p) => p.name) };
  }
  if (name === "check_return_eligibility") {
    const o = ORDERS[input.order_id?.toUpperCase()];
    if (!o) return { error: `No order found with ID ${input.order_id}` };
    if (!o.delivered) return { eligible: false, reason: "Not yet delivered" };
    const days = Math.floor((new Date("2026-09-11") - new Date(o.delivered)) / (1000 * 60 * 60 * 24));
    return { eligible: days <= 15, days_since_delivery: days, window_days: 15 };
  }
  if (name === "create_ticket") {
    return { ticket_created: true };
  }
  return { error: "Unknown tool" };
}

const QUICK_ACTIONS = [
  "Track my order KG-1077",
  "What's your return policy?",
  "Care tips for a snake plant",
  "Talk to a person",
];

export default function App() {
  const [displayLog, setDisplayLog] = useState([
    {
      role: "assistant",
      text: "Vanakkam! I'm here to help with orders, returns, or plant care. What's going on?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState([]);
  const apiHistoryRef = useRef([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    loadTickets();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [displayLog, loading]);

  async function loadTickets() {
    try {
      const res = await window.storage.get("tickets", false);
      if (res && res.value) setTickets(JSON.parse(res.value));
    } catch (e) {
      // no tickets yet
    }
  }

  async function saveTicket(ticket) {
    try {
      const next = [ticket, ...tickets];
      await window.storage.set("tickets", JSON.stringify(next), false);
      setTickets(next);
    } catch (e) {
      console.error("Could not save ticket", e);
    }
  }

  async function send(text) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
    setInput("");
    setDisplayLog((log) => [...log, { role: "user", text: userText }]);
    setLoading(true);

    const working = [...apiHistoryRef.current, { role: "user", content: userText }];

    try {
      let finalText = "";
      const notes = [];

      for (let i = 0; i < 5; i++) {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages: working,
          }),
        });
        const data = await resp.json();
        const content = data.content || [];
        const toolUses = content.filter((b) => b.type === "tool_use");
        const textBlocks = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

        if (toolUses.length === 0) {
          finalText = textBlocks;
          break;
        }

        working.push({ role: "assistant", content });

        const toolResults = [];
        for (const t of toolUses) {
          const result = runTool(t.name, t.input);
          if (t.name === "create_ticket") {
            const ticket = {
              id: "T-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
              time: new Date().toISOString(),
              reason: t.input.reason,
              orderId: t.input.order_id || null,
            };
            await saveTicket(ticket);
            notes.push(`Opened ticket ${ticket.id}`);
          } else {
            notes.push(`Checked ${t.name.replace("_", " ")}: ${t.input.order_id || t.input.query || ""}`);
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: t.id,
            content: JSON.stringify(result),
          });
        }
        working.push({ role: "user", content: toolResults });
      }

      apiHistoryRef.current = working.concat(finalText ? [{ role: "assistant", content: finalText }] : []);
      setDisplayLog((log) => [
        ...log,
        ...notes.map((n) => ({ role: "note", text: n })),
        { role: "assistant", text: finalText || "Sorry, I couldn't find an answer to that. Want me to connect you with a person?" },
      ]);
    } catch (e) {
      setDisplayLog((log) => [
        ...log,
        { role: "assistant", text: "Something went wrong on my end. Please try again, or ask to talk to a person." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #C9A227; color: #1C2A1F; }
        button:focus-visible, input:focus-visible { outline: 2px solid #23412C; outline-offset: 2px; }
        .chip:hover { border-color: #23412C; color: #23412C; }
        .send-btn:hover { background: #1A3121; }
        .send-btn:disabled { opacity: 0.5; cursor: default; }
        input::placeholder { color: #9C9682; }
        @media (max-width: 760px) {
          .kg-layout { flex-direction: column !important; }
          .kg-sidebar { width: 100% !important; border-right: none !important; border-bottom: 1px solid #D9D2BF; }
        }
      `}</style>

      <header style={styles.header}>
        <div style={styles.brandMark}>✿</div>
        <div>
          <div style={styles.brandName}>Kaani Green</div>
          <div style={styles.tagline}>Help counter</div>
        </div>
      </header>

      <div className="kg-layout" style={styles.layout}>
        <aside className="kg-sidebar" style={styles.sidebar}>
          <div style={styles.sideSection}>
            <div style={styles.sideLabel}>Ask about</div>
            <div style={styles.chipList}>
              {QUICK_ACTIONS.map((q) => (
                <button key={q} className="chip" style={styles.chip} onClick={() => send(q)} disabled={loading}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div style={styles.divider} />

          <div style={styles.sideSection}>
            <div style={styles.sideLabel}>Sample order IDs</div>
            <div style={styles.tagRow}>
              {Object.keys(ORDERS).map((id) => (
                <span key={id} style={styles.idTag}>{id}</span>
              ))}
            </div>
            <div style={styles.smallNote}>Try asking about one of these.</div>
          </div>

          <div style={styles.divider} />

          <div style={styles.sideSection}>
            <div style={styles.sideLabel}>Your tickets</div>
            {tickets.length === 0 ? (
              <div style={styles.smallNote}>None yet — escalated issues will show up here.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tickets.map((t) => (
                  <div key={t.id} style={styles.ticketCard}>
                    <div style={styles.ticketId}>{t.id}</div>
                    <div style={styles.ticketReason}>{t.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main style={styles.main}>
          <div ref={scrollRef} style={styles.thread}>
            {displayLog.map((m, i) =>
              m.role === "note" ? (
                <div key={i} style={styles.noteLine}>⌁ {m.text}</div>
              ) : (
                <div key={i} style={styles.turn}>
                  <div style={m.role === "user" ? styles.turnLabelUser : styles.turnLabelAssistant}>
                    {m.role === "user" ? "You" : "Kaani"}
                  </div>
                  <div style={m.role === "user" ? styles.userText : styles.assistantText}>{m.text}</div>
                </div>
              )
            )}
            {loading && <div style={styles.noteLine}>⌁ Checking…</div>}
          </div>

          <form
            style={styles.inputRow}
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              style={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about an order, a plant, or a return…"
              disabled={loading}
            />
            <button className="send-btn" type="submit" style={styles.sendBtn} disabled={loading || !input.trim()}>
              Send
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}

const styles = {
  app: {
    fontFamily: "'Inter', sans-serif",
    background: "#F1EDE2",
    color: "#1C2A1F",
    minHeight: "100%",
    width: "100%",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "18px 24px",
    borderBottom: "1px solid #D9D2BF",
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "#23412C",
    color: "#F1EDE2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    flexShrink: 0,
  },
  brandName: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    lineHeight: 1.1,
  },
  tagline: {
    fontSize: 13,
    color: "#6F6A57",
    marginTop: 2,
  },
  layout: {
    display: "flex",
    flex: 1,
    minHeight: 0,
  },
  sidebar: {
    width: 280,
    flexShrink: 0,
    borderRight: "1px solid #D9D2BF",
    padding: "20px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 18,
    overflowY: "auto",
  },
  sideSection: {},
  sideLabel: {
    fontFamily: "'Fraunces', serif",
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 10,
    color: "#23412C",
  },
  chipList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  chip: {
    textAlign: "left",
    background: "#F8F5EC",
    border: "1px solid #D9D2BF",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13.5,
    color: "#3A3826",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    transition: "border-color 0.15s, color 0.15s",
  },
  divider: {
    height: 1,
    background: "#D9D2BF",
  },
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  idTag: {
    fontSize: 12.5,
    border: "1px dashed #B7AE8F",
    borderRadius: 5,
    padding: "3px 7px",
    color: "#6F6A57",
  },
  smallNote: {
    fontSize: 12.5,
    color: "#8C8770",
    marginTop: 8,
    lineHeight: 1.5,
  },
  ticketCard: {
    background: "#F8F5EC",
    border: "1px solid #D9D2BF",
    borderRadius: 8,
    padding: "8px 10px",
  },
  ticketId: {
    fontSize: 12,
    fontWeight: 600,
    color: "#B5652E",
    marginBottom: 2,
  },
  ticketReason: {
    fontSize: 12.5,
    color: "#3A3826",
    lineHeight: 1.4,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  thread: {
    flex: 1,
    overflowY: "auto",
    padding: "22px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  turn: {
    maxWidth: 560,
  },
  turnLabelUser: {
    fontSize: 11.5,
    color: "#8C8770",
    marginBottom: 3,
  },
  turnLabelAssistant: {
    fontSize: 11.5,
    color: "#8C8770",
    marginBottom: 3,
  },
  userText: {
    fontSize: 15,
    fontWeight: 600,
    color: "#1C2A1F",
    borderBottom: "1px solid #D9D2BF",
    paddingBottom: 12,
  },
  assistantText: {
    fontSize: 15,
    color: "#2C3E28",
    lineHeight: 1.55,
    borderBottom: "1px solid #D9D2BF",
    paddingBottom: 12,
  },
  noteLine: {
    fontSize: 12,
    color: "#B5652E",
    fontStyle: "italic",
  },
  inputRow: {
    display: "flex",
    gap: 10,
    padding: "16px 28px 22px",
    borderTop: "1px solid #D9D2BF",
  },
  input: {
    flex: 1,
    background: "#FFFFFF",
    border: "1px solid #D9D2BF",
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 14.5,
    fontFamily: "'Inter', sans-serif",
    color: "#1C2A1F",
  },
  sendBtn: {
    background: "#23412C",
    color: "#F1EDE2",
    border: "none",
    borderRadius: 8,
    padding: "0 20px",
    fontSize: 14.5,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    transition: "background 0.15s",
  },
};
