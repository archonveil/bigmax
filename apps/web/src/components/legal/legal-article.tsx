import type { ReactNode } from "react";

interface LegalArticleProps {
  title: string;
  updatedAt?: string;
  children: ReactNode;
}

export function LegalArticle({ title, updatedAt, children }: LegalArticleProps): JSX.Element {
  return (
    <article className="container max-w-3xl py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{title}</h1>
        {updatedAt ? <p className="mt-2 text-sm text-muted-foreground">{updatedAt}</p> : null}
      </header>
      <div className="space-y-8 text-[15px] leading-relaxed text-foreground">{children}</div>
    </article>
  );
}

interface LegalSectionProps {
  title: string;
  children: ReactNode;
}

export function LegalSection({ title, children }: LegalSectionProps): JSX.Element {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-muted-foreground">{children}</div>
    </section>
  );
}
