import DarkPageLayout from './DarkPageLayout';

type LegalSection = {
  title: string;
  paragraphs: string[];
};

type LegalDocumentPageProps = {
  title: string;
  eyebrow: string;
  pageTitle: string;
  pageSubtitle: string;
  effectiveDate: string;
  sections: LegalSection[];
};

const LEGAL_PAGE_CSS = `
  .legal-page { padding-top:32px; padding-bottom:42px; }
  .legal-header { margin-bottom:22px; }
  .legal-meta { display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px; background:var(--surface-2); border:1px solid var(--border-subtle); color:var(--text-muted); font-size:12px; font-weight:700; }
  .legal-card { padding:24px; display:flex; flex-direction:column; gap:22px; }
  .legal-section { display:flex; flex-direction:column; gap:10px; padding-top:18px; border-top:1px solid var(--border-subtle); }
  .legal-section:first-child { border-top:none; padding-top:0; }
  .legal-section-title { margin:0; font-size:18px; font-weight:800; letter-spacing:-0.02em; color:var(--text-primary); }
  .legal-copy { margin:0; font-size:14px; line-height:1.7; color:var(--text-secondary); }
  .legal-highlight { padding:14px 16px; border-radius:16px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); color:var(--accent-fg); font-size:13px; font-weight:700; line-height:1.6; }
  .p-public-root.p-public-theme-light .legal-card { box-shadow:0 12px 28px var(--border-subtle); }
  @media (max-width: 600px) {
    .legal-page { padding-top:24px; padding-bottom:28px; }
    .legal-card { padding:20px; gap:18px; }
    .legal-section { padding-top:16px; }
    .legal-section-title { font-size:17px; }
  }
`;

export default function LegalDocumentPage({
  title,
  eyebrow,
  pageTitle,
  pageSubtitle,
  effectiveDate,
  sections
}: LegalDocumentPageProps) {
  return (
    <DarkPageLayout
      title={title}
      extraCss={LEGAL_PAGE_CSS}
      breadcrumbs={[
        { label: 'Inicio', href: '/' },
        { label: 'Legal' },
      ]}
    >
      <main className="p-public-page-sm legal-page">
        <header className="legal-header">
          <span className="p-public-page-eyebrow">{eyebrow}</span>
          <h1 className="p-public-page-h">{pageTitle}</h1>
          <p className="p-public-page-sub">{pageSubtitle}</p>
        </header>

        <section className="p-public-card legal-card">
          <div className="legal-meta">Vigente desde {effectiveDate}</div>
          <div className="legal-highlight">
            Si necesitás ayuda sobre privacidad, acceso o eliminación de datos, podés escribir a{' '}
            <a href="mailto:pique.soporte@gmail.com" style={{ textDecoration: 'underline' }}>
              pique.soporte@gmail.com
            </a>.
          </div>

          {sections.map((section) => (
            <article key={section.title} className="legal-section">
              <h2 className="legal-section-title">{section.title}</h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={`${section.title}-${index}`} className="legal-copy">
                  {paragraph}
                </p>
              ))}
            </article>
          ))}
        </section>
      </main>
    </DarkPageLayout>
  );
}
