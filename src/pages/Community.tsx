import NexusHero from "@/components/community/NexusHero";
import TierSystem from "@/components/community/TierSystem";
import Leaderboard from "@/components/community/Leaderboard";
import BadgeShowcase from "@/components/community/BadgeShowcase";
import IncentivesSection from "@/components/community/IncentivesSection";
import CTAFooter from "@/components/community/CTAFooter";

const Community = () => {
  return (
    <div className="min-h-screen bg-nexus-surface text-foreground dark">
      <NexusHero />
      <TierSystem />
      <Leaderboard />
      <BadgeShowcase />
      <IncentivesSection />
      <CTAFooter />
    </div>
  );
};

export default Community;
