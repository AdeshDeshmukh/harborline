import Link from "next/link";
import { CashBreakdown } from "../features/demo/cash-breakdown";
import { demoAllowance, startDemo } from "../features/demo/demo-plan";

export const metadata = {
  description: "See how rent and a personal buffer shape what you can set aside to invest. Try Harborline with fictional USDC amounts.",
};

export default function Home() {
  return (
    <main className="harbor-public">
      <div className="harbor-shell">
        <header className="harbor-header">
          <span className="harbor-wordmark">Harborline</span>
          <Link href="/sign-in" prefetch={false} className="harbor-link">Private pilot sign-in</Link>
        </header>
        <section className="harbor-hero" aria-labelledby="hero-heading">
          <div>
            <p className="harbor-eyebrow">For freelancers paid in USDC</p>
            <h1 id="hero-heading" className="harbor-hero-title">See what’s left <em>to invest.</em></h1>
            <p className="harbor-intro">Start with your balance. Account for rent and a buffer you choose. See what remains for investing.</p>
            <Link href="/demo" prefetch={false} className="harbor-button harbor-button-primary harbor-hero-action">Try the demo <span aria-hidden="true">↗</span></Link>
            <p className="harbor-note">Fictional amounts · No account needed</p>
          </div>
          <CashBreakdown allowance={demoAllowance(startDemo())} />
        </section>
      </div>
    </main>
  );
}
