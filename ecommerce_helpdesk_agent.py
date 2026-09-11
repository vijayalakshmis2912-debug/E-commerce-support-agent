"""
AI E-COMMERCE CUSTOMER SUPPORT AGENT
Agentic AI prototype — multi-agent pipeline for automated e-commerce support.

Agents:
    IntakeAgent          - normalises the incoming customer message
    ClassificationAgent  - categorises intent + assigns priority
    KnowledgeAgent       - RAG-style keyword retrieval over store policies/FAQ
    OrderLookupAgent     - fetches order data from the store's order system
    ResolutionAgent      - executes pre-approved automated fixes (refund/return/reship)
    EscalationAgent      - hands off unresolved/sensitive cases to a human agent
    OrchestratorAgent    - plans and coordinates the pipeline end-to-end

This prototype uses mock data so it runs standalone, with no external
API keys or network access required. In production, KnowledgeAgent would
query a vector database (Chroma/Milvus) and OrderLookupAgent/ResolutionAgent
would call the real store platform's API (Shopify/WooCommerce) and payment
gateway.
"""

import re
import time
import random
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Mock store data
# ---------------------------------------------------------------------------

ORDER_DB = {
    "EC-2201": {"status": "Delivered", "delivered_days_ago": 4, "item": "Wireless Earbuds", "amount": 1499},
    "EC-2214": {"status": "Shipped", "delivered_days_ago": None, "item": "Running Shoes, UK 9", "amount": 2299},
    "EC-2230": {"status": "Delivered", "delivered_days_ago": 21, "item": "Bluetooth Speaker", "amount": 1899},
    "EC-2247": {"status": "Processing", "delivered_days_ago": None, "item": "Office Chair", "amount": 6499},
}

KNOWLEDGE_BASE = [
    {"keywords": ["return", "refund"], "answer": "Items can be returned within 10 days of delivery in original packaging; refunds are processed within 5-7 business days."},
    {"keywords": ["shipping", "delivery", "track"], "answer": "Standard delivery takes 3-6 business days; you can track any shipped order with its order ID."},
    {"keywords": ["cancel"], "answer": "Orders can be cancelled free of charge before they are marked 'Shipped'."},
    {"keywords": ["payment", "charged", "upi", "card"], "answer": "We accept UPI, cards, net banking, and COD for orders under ₹5000."},
    {"keywords": ["damaged", "broken", "wrong item", "defective"], "answer": "Damaged, wrong, or defective items are replaced free of cost — no return window applies, just share a photo."},
]

RETURN_WINDOW_DAYS = 10


# ---------------------------------------------------------------------------
# Ticket object shared across the agent pipeline
# ---------------------------------------------------------------------------

@dataclass
class Ticket:
    ticket_id: str
    message: str
    order_id: Optional[str] = None
    category: str = ""
    priority: str = ""
    knowledge_answer: str = ""
    order_info: Optional[dict] = None
    resolution: str = ""
    status: str = "Open"
    handled_by: str = ""
    trace: list = field(default_factory=list)
    start_time: float = field(default_factory=time.time)
    elapsed_sec: float = 0.0

    def log(self, agent, note):
        self.trace.append(f"[{agent}] {note}")


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

class IntakeAgent:
    """Normalises the raw customer message and pulls out an order ID if present."""

    ORDER_ID_RE = re.compile(r"\bEC-\d{4}\b", re.IGNORECASE)

    def run(self, ticket: Ticket):
        match = self.ORDER_ID_RE.search(ticket.message)
        if match:
            ticket.order_id = match.group(0).upper()
        ticket.log("IntakeAgent", f"Normalised message. Order ID detected: {ticket.order_id or 'none'}")


class ClassificationAgent:
    """Rule-based intent classifier (stand-in for a fine-tuned NLP/LLM classifier)."""

    RULES = [
        ("return_refund", ["return", "refund", "money back"], "Medium"),
        ("order_status", ["where is", "track", "status", "shipped", "arriving"], "Low"),
        ("cancellation", ["cancel"], "Medium"),
        ("damaged_item", ["damaged", "broken", "wrong item", "defective"], "High"),
        ("payment_issue", ["charged", "payment", "double charged", "not refunded"], "High"),
        ("general_query", [], "Low"),
    ]

    def run(self, ticket: Ticket):
        text = ticket.message.lower()
        for category, keywords, priority in self.RULES:
            if any(k in text for k in keywords):
                ticket.category = category
                ticket.priority = priority
                ticket.log("ClassificationAgent", f"Category={category}, Priority={priority}")
                return
        ticket.category, ticket.priority = "general_query", "Low"
        ticket.log("ClassificationAgent", "Category=general_query, Priority=Low")


class KnowledgeAgent:
    """Keyword-matching stand-in for a RAG lookup over the store's policy/FAQ base."""

    def run(self, ticket: Ticket):
        text = ticket.message.lower()
        for entry in KNOWLEDGE_BASE:
            if any(k in text for k in entry["keywords"]):
                ticket.knowledge_answer = entry["answer"]
                ticket.log("KnowledgeAgent", "Relevant policy found in knowledge base")
                return
        ticket.log("KnowledgeAgent", "No direct policy match")


class OrderLookupAgent:
    """Fetches live order data (mock of a Shopify/WooCommerce order API call)."""

    def run(self, ticket: Ticket):
        if not ticket.order_id:
            ticket.log("OrderLookupAgent", "Skipped — no order ID in message")
            return
        order = ORDER_DB.get(ticket.order_id)
        if order:
            ticket.order_info = order
            ticket.log("OrderLookupAgent", f"Order found: {order['status']}, item: {order['item']}")
        else:
            ticket.log("OrderLookupAgent", "Order ID not found in system")


class ResolutionAgent:
    """Executes safe, pre-approved automated actions."""

    def run(self, ticket: Ticket) -> bool:
        cat = ticket.category
        order = ticket.order_info

        if cat == "order_status" and order:
            ticket.resolution = f"Order {ticket.order_id} is currently '{order['status']}'."
            ticket.status, ticket.handled_by = "Resolved", "ResolutionAgent"
            return True

        if cat == "return_refund" and order:
            if order["status"] == "Delivered" and order["delivered_days_ago"] is not None and order["delivered_days_ago"] <= RETURN_WINDOW_DAYS:
                ticket.resolution = f"Return initiated for order {ticket.order_id}; refund of ₹{order['amount']} will process in 5-7 business days."
                ticket.status, ticket.handled_by = "Resolved", "ResolutionAgent"
                return True
            ticket.resolution = "Outside the 10-day return window — needs manual review."
            return False

        if cat == "cancellation" and order:
            if order["status"] == "Processing":
                ticket.resolution = f"Order {ticket.order_id} cancelled and refund initiated."
                ticket.status, ticket.handled_by = "Resolved", "ResolutionAgent"
                return True
            ticket.resolution = f"Order already '{order['status']}' — cannot auto-cancel."
            return False

        if cat == "damaged_item":
            ticket.resolution = "Needs photo proof of damage — routed to human for verification."
            return False

        if cat == "payment_issue":
            # Billing disputes always go to a human — outside the agent's approved scope.
            ticket.resolution = "Billing discrepancy flagged — requires manual verification against payment gateway records."
            return False

        # No specific order referenced (general policy/FAQ question) — answer from
        # the knowledge base rather than escalating a question with nothing to act on.
        if not ticket.order_id and ticket.knowledge_answer:
            ticket.resolution = ticket.knowledge_answer
            ticket.status, ticket.handled_by = "Resolved", "ResolutionAgent"
            return True

        return False


class EscalationAgent:
    """Hands unresolved/sensitive tickets to a human agent with full context."""

    def run(self, ticket: Ticket):
        ticket.status = "Escalated"
        ticket.handled_by = "Human Engineer"
        if not ticket.resolution:
            ticket.resolution = "Escalated to a human agent with full ticket context."
        ticket.log("EscalationAgent", "Handed off to human support with diagnostic context")


class OrchestratorAgent:
    """Plans and runs the full pipeline for a ticket."""

    def __init__(self):
        self.intake = IntakeAgent()
        self.classify = ClassificationAgent()
        self.knowledge = KnowledgeAgent()
        self.order_lookup = OrderLookupAgent()
        self.resolve = ResolutionAgent()
        self.escalate = EscalationAgent()

    def run(self, ticket: Ticket):
        self.intake.run(ticket)
        self.classify.run(ticket)
        self.knowledge.run(ticket)
        self.order_lookup.run(ticket)

        resolved = self.resolve.run(ticket)
        ticket.log("ResolutionAgent", ticket.resolution or "No automated fix applied")

        if not resolved:
            self.escalate.run(ticket)

        # simulate processing latency, matching the reference report's format
        ticket.elapsed_sec = round(random.uniform(0.3, 2.2) if resolved else random.uniform(8, 20) * 60 / 60, 2)
        return ticket


# ---------------------------------------------------------------------------
# Demo run
# ---------------------------------------------------------------------------

SAMPLE_TICKETS = [
    ("EC-T1", "Hi, where is my order EC-2214? It hasn't arrived yet."),
    ("EC-T2", "I want a refund for order EC-2201, the earbuds don't fit well."),
    ("EC-T3", "Please cancel order EC-2247, I ordered it by mistake."),
    ("EC-T4", "The speaker I got in order EC-2230 arrived broken, screen cracked."),
    ("EC-T5", "I was charged twice for my last order, can you check?"),
    ("EC-T6", "What is your return policy?"),
]

if __name__ == "__main__":
    orchestrator = OrchestratorAgent()
    results = []

    print("=" * 72)
    print("AI E-COMMERCE CUSTOMER SUPPORT AGENT — pipeline run")
    print("=" * 72)

    for ticket_id, message in SAMPLE_TICKETS:
        t = Ticket(ticket_id=ticket_id, message=message)
        orchestrator.run(t)
        results.append(t)

        print(f"\nTicket {t.ticket_id}: \"{t.message}\"")
        for line in t.trace:
            print(f"   {line}")
        print(f"   → Status: {t.status} | Handled by: {t.handled_by} | Time: {t.elapsed_sec}s")

    print("\n" + "=" * 72)
    print("RESOLVED-TICKET LOG")
    print("=" * 72)
    header = f"{'Ticket':<8}{'Category':<16}{'Status':<12}{'Handled By':<18}{'Time':<8}"
    print(header)
    print("-" * len(header))
    for t in results:
        print(f"{t.ticket_id:<8}{t.category:<16}{t.status:<12}{t.handled_by:<18}{str(t.elapsed_sec)+'s':<8}")

    resolved_count = sum(1 for t in results if t.status == "Resolved")
    print(f"\nAuto-resolved: {resolved_count}/{len(results)} "
          f"({round(100 * resolved_count / len(results))}% first-contact resolution)")
