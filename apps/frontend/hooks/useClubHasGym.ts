import { useEffect, useState } from 'react';
import { ActivityTurnService } from '../services/ActivityTurnService';
import { SubscriptionAdminService } from '../services/SubscriptionAdminService';

// Por club: ¿tiene turnero o planes? Se guarda acá para no preguntarlo en cada cambio de página.
const cache = new Map<string, boolean>();
const pending = new Map<string, Promise<boolean>>();

const fetchHasGym = (slug: string) => {
  const inFlight = pending.get(slug);
  if (inFlight) return inFlight;
  const request = Promise.all([
    ActivityTurnService.listSchedules(slug).catch(() => []),
    SubscriptionAdminService.listPlans(slug).catch(() => []),
  ])
    .then(([schedules, plans]) => {
      const hasGym = (Array.isArray(schedules) && schedules.length > 0) || (Array.isArray(plans) && plans.length > 0);
      cache.set(slug, hasGym);
      return hasGym;
    })
    .finally(() => pending.delete(slug));
  pending.set(slug, request);
  return request;
};

/** Al crear el primer turnero o plan, para que Gimnasio aparezca en el menú sin recargar. */
export const markClubHasGym = (slug: string) => {
  if (slug) cache.set(slug, true);
};

/** null mientras no se sabe. */
export default function useClubHasGym(slug: string | null | undefined): boolean | null {
  const [hasGym, setHasGym] = useState<boolean | null>(() => (slug ? cache.get(slug) ?? null : null));

  useEffect(() => {
    if (!slug) {
      setHasGym(null);
      return;
    }
    let cancelled = false;
    setHasGym(cache.get(slug) ?? null);
    if (!cache.has(slug)) {
      void fetchHasGym(slug).then((value) => {
        if (!cancelled) setHasGym(value);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return hasGym;
}
