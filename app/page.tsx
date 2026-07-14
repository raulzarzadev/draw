import dynamic from "next/dynamic";

const DrawCanvas = dynamic(() => import("../components/DrawCanvas"), {
  ssr: false,
  loading: () => (
    <main className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">Draw</p>
        <h1>Loading...</h1>
      </section>
    </main>
  ),
});

export default function Page() {
  return <DrawCanvas />;
}
