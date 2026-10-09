import { Link } from "@tanstack/react-router";
import { BookOpen, FileText, Globe, Headphones, MessageSquare, ShieldCheck } from "lucide-react";
import heroImg from "@/assets/lofi-study-room.jpg";
import { Logo } from "@/components/Logo";

const FEATURES = [
  { icon: MessageSquare, title: "Chat with your documents", body: "Upload PDFs and TXT files and ask questions about their contents." },
  { icon: ShieldCheck, title: "Grounded AI answers", body: "Answers built from relevant passages in your uploads — with citations you can check." },
  { icon: Globe, title: "Study resources", body: "Discover useful external websites related to what you're studying." },
  { icon: FileText, title: "Organized documents", body: "View processing status, manage and delete your uploaded material." },
  { icon: Headphones, title: "Lo-fi atmosphere", body: "A tiny three-track lo-fi playlist to keep you in the zone." },
];

const STEPS = [
  { n: "01", t: "Upload", d: "Drop in your notes, slides or papers." },
  { n: "02", t: "Index", d: "We split them into passages and map their meaning." },
  { n: "03", t: "Ask", d: "Your question finds the most relevant passages." },
  { n: "04", t: "Answer", d: "The AI answers only from those passages — and shows its sources." },
];

function Stars() {
  const pts = [[8, 12], [22, 30], [40, 8], [65, 20], [80, 10], [92, 35], [15, 55], [55, 45], [88, 60]];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {pts.map(([x, y], i) => (
        <span
          key={i}
          className="absolute h-1 w-1 bg-lavender animate-twinkle"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.4}s` }}
        />
      ))}
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 border-b-[3px] border-accent bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <Link to="/chat" className="btn-pixel btn-cyan">Try now</Link>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <Stars />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-2 lg:py-20">
          <div className="relative z-10">
            <p className="font-mono-retro text-xl text-primary">&gt; study_mode.exe<span className="animate-blink">_</span></p>
            <h1 className="mt-4 font-pixel text-2xl leading-relaxed sm:text-3xl lg:text-4xl lg:leading-snug text-glow-pink">
              Turn your notes into answers
            </h1>
            <p className="mt-6 max-w-lg text-lg text-muted-foreground">
              OmniPrep.ai is your AI study companion. Upload your PDFs and notes, ask anything, and get
              answers grounded in your own material — with sources you can check.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/chat" className="btn-pixel btn-cyan">Try now ▶</Link>
              <a href="#how" className="btn-pixel btn-ghost-pixel">How it works</a>
            </div>
          </div>
          <div className="relative">
            {/* Replace src/assets/lofi-study-room.jpg to swap the hero art. */}
            <div className="pixel-border scanlines overflow-hidden animate-float">
              <img
                src={heroImg}
                alt="Pixel art of a student with headphones studying at night by a city window"
                width={1536}
                height={1024}
                className="pixelated block h-auto w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-pixel text-lg sm:text-xl text-center">
          <span className="text-accent">★</span> Power-ups <span className="text-accent">★</span>
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.title} className="pixel-border-soft bg-surface p-6 transition-colors hover:border-accent">
              <div className="inline-flex h-11 w-11 items-center justify-center border-2 border-primary bg-background text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-pixel text-[0.7rem] leading-relaxed text-lavender">{f.title}</h3>
              <p className="mt-2 text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-16">
        <div className="pixel-border bg-surface p-6 sm:p-10">
          <h2 className="font-pixel text-base sm:text-lg">How it works</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            OmniPrep uses a technique called retrieval-augmented generation: instead of guessing, it first
            looks up the parts of your documents that matter, then answers from them.
          </p>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="font-pixel text-2xl text-primary text-glow-cyan">{s.n}</span>
                <h3 className="mt-3 font-pixel text-[0.7rem] text-accent">{s.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="border-t-[3px] border-accent mt-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              An AI study assistant that answers from your own notes and points you to good resources.
            </p>
          </div>
          <nav className="flex gap-6 font-mono-retro text-lg" aria-label="Footer">
            <a href="#features" className="hover:text-primary">Features</a>
            <a href="#how" className="hover:text-primary">How it works</a>
            <Link to="/chat" className="hover:text-primary flex items-center gap-1"><BookOpen className="h-4 w-4" />Open app</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
