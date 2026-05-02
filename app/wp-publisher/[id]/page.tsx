// app/wp-publisher/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import ProjectCard from '@/components/ProjectCard';
import { auth } from '@/lib/auth';
import { getProject, publicProject } from '@/lib/projects';
import { ownsProject } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const project = getProject(params.id);
  if (!project) notFound();
  if (!ownsProject(project.ownerEmail, session?.user?.email)) notFound();

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
