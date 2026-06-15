import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "/admin/tienda?tab=productos", permanent: true },
});

export default function Page() {
  return null;
}
