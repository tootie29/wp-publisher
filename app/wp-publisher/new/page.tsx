// app/wp-publisher/new/page.tsx
import ProjectForm from '@/components/ProjectForm';

export default function NewProjectPage() {
  return (
    <>
      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold">Add project</h1>
          <p className="text-white/60 mt-1">Configure a new WordPress site + Google Sheet pairing</p>
        </div>
        <ProjectForm mode="create" />
      </main>
    </>
  );
}
