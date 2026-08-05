import CompanySubNav from '@/components/eos/CompanySubNav';

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <CompanySubNav />
      {children}
    </div>
  );
}
