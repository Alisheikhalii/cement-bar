'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { registerDriverSchema } from '@cb/shared';
import { fa } from '@/i18n/fa';
import { api } from '@/lib/api';

/** Registration form = shared server schema + client-only password confirmation. */
export const registerFormSchema = registerDriverSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: fa.register.passwordMismatch,
  });

export type RegisterForm = z.input<typeof registerFormSchema>;

export interface CarrierOption {
  id: string;
  name: string;
  code: string;
}
export interface LoaderTypeOption {
  id: string;
  title: string;
}
export interface CityOption {
  id: number;
  name: string;
  province: string;
}

const LOOKUP_STALE_MS = 5 * 60_000;
const CITY_MIN_CHARS = 2;
const CITY_DEBOUNCE_MS = 300;

export function useCarriers() {
  return useQuery({
    queryKey: ['public', 'carriers'],
    queryFn: ({ signal }) => api.get<CarrierOption[]>('/public/carriers', { signal }),
    staleTime: LOOKUP_STALE_MS,
  });
}

export function useLoaderTypes() {
  return useQuery({
    queryKey: ['public', 'loader-types'],
    queryFn: ({ signal }) => api.get<LoaderTypeOption[]>('/public/loader-types', { signal }),
    staleTime: LOOKUP_STALE_MS,
  });
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useCitySearch(query: string) {
  const q = useDebounced(query.trim(), CITY_DEBOUNCE_MS);
  const enabled = q.length >= CITY_MIN_CHARS;
  const res = useQuery({
    queryKey: ['public', 'cities', q],
    queryFn: ({ signal }) => api.get<CityOption[]>('/public/cities', { query: { q }, signal }),
    enabled,
    staleTime: LOOKUP_STALE_MS,
  });
  return { ...res, enabled, tooShort: query.trim().length < CITY_MIN_CHARS };
}
