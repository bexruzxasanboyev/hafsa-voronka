"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingScreen, MiniAppGate, useMiniApp } from "@/components/miniapp/MiniAppProvider";
import { LinkExpiredScreen } from "@/components/watch/LinkExpiredScreen";
import { OfferFirstScreen } from "@/components/watch/OfferFirstScreen";
import { WatchScreen } from "@/components/watch/WatchScreen";
import { nextOfferGate, offerGateFor } from "@/lib/watch/offerGate";

function WatchPageContent() {
  const router = useRouter();
  const { session } = useMiniApp();
  const [gate, setGate] = useState(() => offerGateFor(session));
  const offer = nextOfferGate(gate, session);
  if (offer !== gate) setGate(offer);

  useEffect(() => {
    if (!session.registered) router.replace("/app");
  }, [router, session.registered]);

  if (!session.registered) return <LoadingScreen />;
  if (session.expired) return <LinkExpiredScreen />;
  if (offer.url !== null && !offer.dismissed) {
    return <OfferFirstScreen url={offer.url} onContinue={() => setGate({ ...offer, dismissed: true })} />;
  }
  return <WatchScreen />;
}

export default function WatchPage() {
  return (
    <MiniAppGate>
      <WatchPageContent />
    </MiniAppGate>
  );
}
