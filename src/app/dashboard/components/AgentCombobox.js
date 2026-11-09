'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { filterAgents, agentLabel } from '../../utils/agentSearch';

/**
 * Searchable selling-agent picker (combobox). It only ever offers the `agents` it is given — the office-scoped list from
 * /api/properties/managed/agents — and the server re-checks the chosen agent on submit, so nothing outside the office can
 * be selected. Mouse, touch and keyboard (↑ ↓ Enter Esc) all work.
 */
export default function AgentCombobox({ id, agents, value, onChange, placeholder = 'Search for the selling agent…' }) {
  const listId = useId();
  const inputRef = useRef(null);
  const selected = agents.find((a) => a.uid === value) || null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterAgents(agents, query), [agents, query]);

  const choose = (a) => {
    onChange(a.uid);
    setQuery('');
    setOpen(false);
  };
  const clear = () => {
    onChange('');
    setQuery('');
    setOpen(true);
    setActive(0);
    inputRef.current?.focus();
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { if (open && matches[active]) { e.preventDefault(); choose(matches[active]); } }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  // Closed with a selection: show the chosen agent (same box size as the input, so nothing moves).
  const showSelected = selected && !open;
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].uid}` : undefined}
          autoComplete="off"
          value={showSelected ? agentLabel(selected) : query}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setActive(0); }}
          onClick={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 120)}
          onKeyDown={onKeyDown}
          className="w-full pl-10 pr-10 py-3 rounded-md border border-stone-300 bg-white text-stone-900 outline-none focus:border-stone-500 placeholder:text-stone-400"
        />
        {selected && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            aria-label="Change selling agent"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Selling agents"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-stone-200 bg-white shadow-lg py-1"
        >
          {matches.length === 0 ? (
            <li className="px-4 py-3 text-sm text-stone-500" role="option" aria-selected="false" aria-disabled="true">
              No agents match “{query.trim()}”. Check the spelling, or ask your office admin if the agent is missing.
            </li>
          ) : matches.map((a, i) => (
            <li
              key={a.uid}
              id={`${listId}-${a.uid}`}
              role="option"
              aria-selected={a.uid === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(a)}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm cursor-pointer ${i === active ? 'bg-stone-100' : ''} ${a.uid === value ? 'font-semibold text-stone-900' : 'text-stone-800'}`}
            >
              <span className="truncate">
                {a.name || a.email}
                {a.loginStatus === 'invited' && <span className="text-stone-400 font-normal"> · not logged in yet</span>}
              </span>
              {a.uid === value && <Check className="w-4 h-4 text-[#e38100] shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
