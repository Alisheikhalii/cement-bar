'use client';
import { useQuery } from '@tanstack/react-query';
import type {
  DriverCompanyDto,
  DriverDashboardDto,
  DriverHallHoursDto,
  DriverProfileDto,
  DriverVehicleDto,
} from '@cb/shared';
import { api, type ApiError } from '@/lib/api';

export const driverKeys = {
  dashboard: ['driver', 'dashboard'] as const,
  profile: ['driver', 'profile'] as const,
  vehicle: ['driver', 'vehicle'] as const,
  companies: ['driver', 'companies'] as const,
  hallHours: ['driver', 'hall-hours'] as const,
};

export function useDriverDashboard() {
  return useQuery<DriverDashboardDto, ApiError>({
    queryKey: driverKeys.dashboard,
    queryFn: ({ signal }) => api.get<DriverDashboardDto>('/driver/dashboard', { signal }),
  });
}

export function useDriverProfile() {
  return useQuery<DriverProfileDto, ApiError>({
    queryKey: driverKeys.profile,
    queryFn: ({ signal }) => api.get<DriverProfileDto>('/driver/profile', { signal }),
  });
}

export function useDriverVehicle() {
  return useQuery<DriverVehicleDto, ApiError>({
    queryKey: driverKeys.vehicle,
    queryFn: ({ signal }) => api.get<DriverVehicleDto>('/driver/profile/vehicle', { signal }),
  });
}

export function useDriverCompanies() {
  return useQuery<DriverCompanyDto[], ApiError>({
    queryKey: driverKeys.companies,
    queryFn: ({ signal }) => api.get<DriverCompanyDto[]>('/driver/companies', { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useDriverHallHours() {
  return useQuery<DriverHallHoursDto, ApiError>({
    queryKey: driverKeys.hallHours,
    queryFn: ({ signal }) => api.get<DriverHallHoursDto>('/driver/hall-hours', { signal }),
    refetchInterval: 5 * 60_000,
  });
}
