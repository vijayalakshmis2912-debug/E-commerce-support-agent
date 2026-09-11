# AI E-commerce Customer Support Agent

An Agentic AI prototype that automates first-line customer support for an
online store — order status, returns, cancellations, and policy questions —
using a team of cooperating AI agents instead of one monolithic chatbot.

## What it does

A central **Orchestrator Agent** breaks down each customer query and routes
it through specialised agents:

- **Intake Agent** — normalises the incoming message and extracts order IDs
- **Classification Agent** — categorises intent (order status, return/refund,
  cancellation, damaged item, payment issue) and assigns a priority
- **Knowledge Agent** — retrieves answers from store policy / FAQ (RAG-style)
- **Order Lookup Agent** — fetches live order data from the store platform
- **Resolution Agent** — executes safe, pre-approved fixes automatically
- **Escalation Agent** — hands off billing disputes, damaged-item claims, and
  anything outside policy to a human agent, with full context attached

Routine queries get resolved instantly and automatically. Anything that
needs human judgement — a billing dispute, a damaged-item claim — is
escalated with the full conversation and order context, not dropped back on
the customer to re-explain.

## Repo contents

| File | What it is |
|---|---|
| `ecommerce_helpdesk_agent.py` | The multi-agent backend pipeline (Python, no API keys needed — runs standalone on mock order/policy data) |
| `kaani-support-agent.jsx` | A React chat-widget frontend that calls the Claude API with tool-use to answer customers live |

## Running the backend demo

```bash
python3 ecommerce_helpdesk_agent.py
```

This runs six sample customer messages through the full pipeline and prints
a trace of every agent's decision, followed by a resolved-ticket log.

## Tech stack

Python · Claude API (tool-use / function calling) · RAG-style knowledge
retrieval · React (frontend chat widget)

## Status

Prototype / academic project — mock order and policy data. Swapping in a
real store's order API (Shopify/WooCommerce) and a vector database for the
knowledge base is the next step toward production.
