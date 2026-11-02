import { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Gauge,
  Globe,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { UrlInspectionResult } from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { bytes, errorMessage } from '../lib/format';
import { Markdown } from './Markdown';
import { SectionLabel, Spinner } from './ui';

const PRESET_URLS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8000',
  'http://127.0.0.1:8080',
];

export function UrlInspectorTab() {
  const toast = useAppStore((state) => state.toast);
  const project = useAppStore((state) => state.project);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const startAgent = useAppStore((state) => state.startAgent);
  const setModelsOpen = useAppStore((state) => state.setModelsOpen);
  const [targetUrl, setTargetUrl] = useState('http://localhost:3000');
  const [inspecting, setInspecting] = useState(false);
  const [result, setResult] = useState<UrlInspectionResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleInspect = async (urlToInspect = targetUrl) => {
    if (!urlToInspect.trim()) return;
    setInspecting(true);
    setResult(null);
    try {
      const audit = await window.forge.tools.inspectUrl(urlToInspect.trim(), true);
      setResult(audit);
      if (audit.statusCode === 0) {
        toast('error', `Connection failed: ${audit.issues[0]?.description || 'Server unreachable'}`);
      } else {
        toast('success', `Inspection complete: ${audit.issues.length} issue(s) analyzed`);
      }
    } catch (err) {
      toast('error', `Inspection failed: ${errorMessage(err)}`);
    } finally {
      setInspecting(false);
    }
  };

  const copyFix = () => {
    if (!result?.aiAnalysis) return;
    navigator.clipboard.writeText(result.aiAnalysis);
    setCopied(true);
    toast('success', 'AI recommendations copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const sendToAgent = () => {
    if (!result) return;
    const criticals = result.issues.filter((i) => i.severity === 'critical');
    const warnings = result.issues.filter((i) => i.severity === 'warning');

    const task = [
      `Inspect and fix live web issues identified for ${result.url}:`,
      '',
      '### Issues Detected:',
      ...result.issues.map(
        (i, idx) => `${idx + 1}. [${i.severity.toUpperCase()}] ${i.title}: ${i.recommendation || i.description}`,
      ),
      '',
      '### AI Technical Diagnosis & Code Fixes:',
      result.aiAnalysis || 'Implement missing security headers, fix empty image attributes, and verify SEO metadata.',
      '',
      'Please inspect our workspace files, apply the necessary code modifications, and verify the fixes.',
    ].join('\n');

    if (!project?.id) {
      toast('info', 'Please open a workspace project before dispatching fixes to the agent.');
      return;
    }

    setModelsOpen(false);
    void startAgent({
      projectId: project.id,
      agent: 'coding',
      task,
      providerId: selectedModel?.providerId,
      model: selectedModel?.model,
    });
    toast('success', `Handed off ${criticals.length + warnings.length} issue(s) to Coding Agent`);
  };

  return (
    <div className="space-y-4">
      {/* Intro Card */}
      <div className="card p-3.5 space-y-2">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-cyan" />
          <h3 className="text-[13px] font-semibold text-fg-strong">Live URL Inspector &amp; Solution Recommender</h3>
        </div>
        <p className="text-[11.5px] leading-relaxed text-muted">
          Inspect any local dev server (<code className="text-fg font-mono">localhost:3000</code>,{' '}
          <code className="text-fg font-mono">localhost:5173</code>) or public URL. Checks HTTP latency, security
          headers, SEO metadata, broken/empty image attributes, and mixed content, with local AI root-cause analysis
          and automated code fix recommendations.
        </p>
      </div>

      {/* URL Input Form */}
      <div className="card p-3 space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleInspect();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="e.g. http://localhost:3000 or https://myapp.com"
              className="mono h-8 w-full pl-8 pr-3 text-[12px]"
              disabled={inspecting}
            />
            <Search size={13} className="absolute left-2.5 top-2.5 text-faint" />
          </div>

          <button
            type="submit"
            className="btn btn-primary h-8 px-3 text-[12px]"
            disabled={inspecting || !targetUrl.trim()}
          >
            {inspecting ? <Spinner className="!h-3.5 !w-3.5" /> : <Gauge size={13} />} Inspect URL
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span className="text-faint text-[10.5px]">Quick dev servers:</span>
          {PRESET_URLS.map((url) => (
            <button
              key={url}
              type="button"
              className="chip hover:text-fg hover:border-line font-mono text-[10.5px]"
              onClick={() => {
                setTargetUrl(url);
                void handleInspect(url);
              }}
              disabled={inspecting}
            >
              {url}
            </button>
          ))}
        </div>
      </div>

      {/* Inspection Results */}
      {result ? (
        <div className="space-y-4">
          {/* Status & Latency Banner */}
          <div className="card p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11.5px] font-semibold ${
                  result.statusCode >= 200 && result.statusCode < 400
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : result.statusCode === 0
                      ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                      : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                }`}
              >
                {result.statusCode === 0 ? (
                  <>
                    <XCircle size={12} /> Connection Failed
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={12} /> {result.statusCode} {result.statusText}
                  </>
                )}
              </span>

              <div className="text-[12px] font-mono text-fg-strong truncate max-w-[280px]" title={result.finalUrl}>
                {result.finalUrl}
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span
                className={`chip ${
                  result.latencyMs < 500
                    ? 'text-emerald-400'
                    : result.latencyMs < 1500
                      ? 'text-amber-400'
                      : 'text-red-400'
                }`}
              >
                <Gauge size={11} /> {result.latencyMs}ms latency
              </span>

              <span className={`chip ${result.ssl ? 'text-emerald-400' : 'text-amber-400'}`}>
                {result.ssl ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
                {result.ssl ? 'HTTPS' : 'Insecure HTTP'}
              </span>

              {result.contentLengthBytes ? (
                <span className="chip">{bytes(result.contentLengthBytes)}</span>
              ) : null}
            </div>
          </div>

          {/* Security Headers Checklist */}
          <div>
            <SectionLabel>Security Headers Matrix</SectionLabel>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { label: 'Content-Security-Policy (CSP)', ok: result.securityHeaders.contentSecurityPolicy },
                { label: 'Strict-Transport-Security (HSTS)', ok: result.securityHeaders.strictTransportSecurity },
                { label: 'X-Content-Type-Options: nosniff', ok: result.securityHeaders.xContentTypeOptions },
                { label: 'X-Frame-Options (Clickjacking)', ok: result.securityHeaders.xFrameOptions },
                { label: 'Referrer-Policy', ok: result.securityHeaders.referrerPolicy },
                { label: 'CORS Access-Control', ok: result.securityHeaders.cors },
              ].map((header) => (
                <div key={header.label} className="card p-2.5 flex items-center gap-2">
                  {header.ok ? (
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle size={14} className="text-amber-400 shrink-0" />
                  )}
                  <span className="truncate text-[11px] text-fg">{header.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SEO & DOM Matrix */}
          <div>
            <SectionLabel>SEO &amp; HTML Structure</SectionLabel>
            <div className="card p-3 grid grid-cols-2 gap-3 text-[11.5px] sm:grid-cols-4">
              <div>
                <div className="text-faint text-[10.5px]">Page Title</div>
                <div className="truncate font-medium text-fg" title={result.seo.title}>
                  {result.seo.title || <span className="text-danger italic">Missing</span>}
                </div>
                <div className="text-[10px] text-muted">{result.seo.titleLength} characters</div>
              </div>

              <div>
                <div className="text-faint text-[10.5px]">Meta Description</div>
                <div className="truncate font-medium text-fg" title={result.seo.description}>
                  {result.seo.description || <span className="text-amber-400 italic">Missing</span>}
                </div>
                <div className="text-[10px] text-muted">{result.seo.descriptionLength} characters</div>
              </div>

              <div>
                <div className="text-faint text-[10.5px]">Headings</div>
                <div className="font-medium text-fg">
                  {result.seo.h1Count} &times; &lt;h1&gt;, {result.seo.h2Count} &times; &lt;h2&gt;
                </div>
                <div className="text-[10px] text-muted">
                  {result.seo.h1Count === 1 ? 'Optimal hierarchy' : 'Hierarchy alert'}
                </div>
              </div>

              <div>
                <div className="text-faint text-[10.5px]">Images (Missing Alt)</div>
                <div
                  className={`font-medium ${
                    result.seo.imagesWithoutAlt > 0 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {result.seo.imagesWithoutAlt} / {result.seo.imagesCount}
                </div>
                <div className="text-[10px] text-muted">WCAG accessibility</div>
              </div>
            </div>
          </div>

          {/* Issues List */}
          <div>
            <SectionLabel>Detected Issues ({result.issues.length})</SectionLabel>
            {result.issues.length === 0 ? (
              <div className="card p-3 text-[12px] text-emerald-400 flex items-center gap-2">
                <CheckCircle2 size={14} /> No issues detected! Clean performance and security posture.
              </div>
            ) : (
              <div className="space-y-2">
                {result.issues.map((issue, idx) => {
                  const tone =
                    issue.severity === 'critical'
                      ? 'border-red-500/30 bg-red-500/5 text-red-300'
                      : issue.severity === 'warning'
                        ? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
                        : 'border-cyan-500/30 bg-cyan-500/5 text-cyan-300';

                  const badge =
                    issue.severity === 'critical'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : issue.severity === 'warning'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30';

                  return (
                    <div key={idx} className={`rounded-md border p-3 space-y-1.5 ${tone}`}>
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9.5px] uppercase font-bold ${badge}`}>
                          {issue.severity}
                        </span>
                        <span className="text-[10px] text-faint uppercase tracking-wider font-mono">
                          {issue.category}
                        </span>
                        <span className="text-[12px] font-semibold text-fg">{issue.title}</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted pl-1">{issue.description}</p>
                      {issue.recommendation ? (
                        <div className="text-[11px] text-fg-strong bg-black/20 p-2 rounded border border-white/5 space-y-0.5">
                          <span className="font-semibold text-accent text-[10.5px]">Recommended Fix:</span>
                          <p>{issue.recommendation}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* AI Recommended Solutions & Code Snippets */}
          {result.aiAnalysis ? (
            <div>
              <div className="flex items-center justify-between pb-1">
                <SectionLabel>Local AI Root-Cause Analysis &amp; Recommended Solutions</SectionLabel>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost h-6 px-2 text-[10.5px]"
                    onClick={copyFix}
                  >
                    {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />} Copy Fix
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary h-6 px-2.5 text-[10.5px]"
                    onClick={sendToAgent}
                  >
                    <Wrench size={11} /> Send to Agent to Fix in Workspace
                  </button>
                </div>
              </div>

              <div className="card p-4 bg-panel-2 border border-line-soft space-y-3">
                <Markdown className="text-[12px]">{result.aiAnalysis}</Markdown>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
