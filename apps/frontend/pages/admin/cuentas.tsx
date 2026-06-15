import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin/caja?tab=accounts', permanent: true },
});

export default function Page() {
  return null;
}
