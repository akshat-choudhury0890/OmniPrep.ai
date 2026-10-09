# ⚡ OmniPrep.ai

> **Turn your study notes into instant, intelligent answers.**  
> OmniPrep.ai is a full-stack Retrieval-Augmented Generation (RAG) study assistant that ingests your PDFs and lecture documents, indexes them using vector database embeddings, and provides precise contextual answers using Google Gemini.

---

## 🚀 Live Demo

- **Frontend Application:** 
- **Backend API:** `https://omniprep-ai-backend.onrender.com`

---

## ✨ Features

- 📄 **Document Management:** Upload `.pdf` or `.txt` study materials directly into your private knowledge library.
- 🎯 **Contextual RAG Retrieval:** Queries return exact responses grounded exclusively in your uploaded notes.
- 🧠 **Google Gemini Powered:** Fast, accurate text embeddings and conversational LLM responses.
- 💾 **Vector Search Database:** Integrated with **Neon PostgreSQL** for efficient vector similarity lookup.
- 👾 **Retro Cyber UI:** Retro/vaporwave synth aesthetic built with modern React.

---

## 🛠️ Tech Stack

### **Frontend**
- **Framework:** React + Vite
- **Styling:** CSS Modules / Custom Retro Cyberpunk Styling
- **Deployment:** Vercel

### **Backend**
- **Runtime:** Node.js
- **Framework:** Fastify (High-performance web framework)
- **Validation:** Zod schema validation
- **Database:** Neon PostgreSQL (Serverless Postgres with Vector Support)
- **AI Model:** Google Gemini API (`gemini-pro` & text embeddings)
- **Deployment:** Render

---

## 🏗️ System Architecture

```text
  ┌──────────────────────┐             ┌──────────────────────┐
  │   React + Vite UI    │  ◄──HTTP──► │   Fastify Backend    │
  │     (Vercel Host)    │             │    (Render Host)     │
  └──────────────────────┘             └──────────┬───────────┘
                                                  │
                                    ┌─────────────┴─────────────┐
                                    ▼                           ▼
                         ┌────────────────────┐      ┌────────────────────┐
                         │  Neon PostgreSQL   │      │ Google Gemini API  │
                         │   (Vector Search)  │      │(Embeddings & Chat) │
                         └────────────────────┘      └────────────────────┘

<img width="1876" height="979" alt="image" src="https://github.com/user-attachments/assets/7444cd7b-b333-4785-9584-d59e7d2cc8cb" />
