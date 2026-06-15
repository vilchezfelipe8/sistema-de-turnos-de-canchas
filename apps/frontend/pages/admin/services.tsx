import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "/admin/tienda?tab=servicios", permanent: true },
});

export default function Page() {
  return null;
}
