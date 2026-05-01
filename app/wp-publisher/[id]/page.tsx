// app/wp-publisher/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import ProjectCard from '@/components/ProjectCard';
import { getProject, publicProject } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) notFound();

  return (
    <main className="max-w-screen-2xl mx-auto px-6 py-10">
      <div className="mb-6">
        <Link
          href="/wp-publisher"
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white transition"
        >
          <ChevronLeft className="w-4 h-4" /> All projects
        </Link>
      </div>
      <ProjectCard project={publicProject(project)} />
    </main>
  );
}
