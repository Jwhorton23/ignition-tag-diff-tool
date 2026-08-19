import { useState } from 'react';
import type { ValidationIssue } from '@ignition-diff/engine';

interface ValidationPanelProps {
  issues: ValidationIssue[];
  onNavigate?: (path: string) => void;
}

/** Runs on load and pre-export (PLAN.md §5) — a collapsed summary banner
 *  that expands into a click-to-navigate list. */
export function ValidationPanel({ issues, onNavigate }: ValidationPanelProps) {
  const [expanded, setExpanded] = useState(false);
  if (issues.length === 0) return null;

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.length - errorCount;

  return (
    <div className={`validation-panel${errorCount > 0 ? ' validation-panel--error' : ' validation-panel--warning'}`}>
      <button type="button" className="validation-panel__summary" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▾' : '▸'} {errorCount > 0 && `${errorCount} error${errorCount === 1 ? '' : 's'}`}
        {errorCount > 0 && warningCount > 0 && ', '}
        {warningCount > 0 && `${warningCount} warning${warningCount === 1 ? '' : 's'}`}
      </button>
      {expanded && (
        <ul className="validation-panel__list">
          {issues.map((issue, i) => (
            <li key={i} className={`validation-panel__issue validation-panel__issue--${issue.severity}`}>
              <button type="button" disabled={!onNavigate} onClick={() => onNavigate?.(issue.path)}>
                <code>{issue.path}</code>: {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
