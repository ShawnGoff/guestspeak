'use client';

import { useState, useEffect, useRef } from 'react';

export interface LocationResult {
  displayName: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    region?: string;
    country?: string;
  };
}

export default function LocationAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Search for a city…',
}: {
  value: string;
  onChange: (display: string) => void;
  onSelect: (result: LocationResult) => void;
  placeholder?: string;
}) {
  const [results, setResults]   = useState<NominatimResult[]>([]);
  const [open, setOpen]         = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleInput(v: string) {
    onChange(v);
    clearTimeout(searchTimer.current);

    if (v.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }

    setSearching(true);
    // Nominatim: max 1 req/sec — debounce at 500ms to be safe
    searchTimer.current = setTimeout(async () => {
      try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('q', v.trim());
        url.searchParams.set('format', 'json');
        url.searchParams.set('addressdetails', '1');
        url.searchParams.set('limit', '5');

        const res = await fetch(url.toString(), {
          headers: { 'Accept-Language': 'en', 'User-Agent': 'GuestSpeakApp/1.0' },
        });
        const data: NominatimResult[] = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
  }

  function handleSelect(r: NominatimResult) {
    const addr = r.address;
    const city    = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? '';
    const region  = addr.state ?? addr.region ?? '';
    const country = addr.country ?? '';

    // Show just "City, Country" in the input rather than the full verbose string
    const label = [city, country].filter(Boolean).join(', ') || r.display_name;

    onChange(label);
    setOpen(false);
    setResults([]);

    onSelect({
      displayName: label,
      city,
      region,
      country,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    });
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="input w-full pr-8"
          autoComplete="off"
        />
        {searching && (
          <svg
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-200/60 animate-spin"
            viewBox="0 0 24 24" fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-brand-card border border-brand-border rounded-xl overflow-hidden z-20 shadow-xl">
          {results.map((r, i) => {
            const addr = r.address;
            const city    = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? '';
            const region  = addr.state ?? addr.region ?? '';
            const country = addr.country ?? '';
            const line1 = city || r.display_name.split(',')[0];
            const line2 = [region, country].filter(Boolean).join(', ');

            return (
              <button
                key={i}
                type="button"
                onMouseDown={e => { e.preventDefault(); handleSelect(r); }}
                className="w-full text-left px-4 py-3 hover:bg-brand-border/20 transition-colors border-b border-brand-border/30 last:border-0"
              >
                <p className="text-sm text-white font-medium">{line1}</p>
                {line2 && <p className="text-xs text-purple-200/70 mt-0.5">{line2}</p>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
