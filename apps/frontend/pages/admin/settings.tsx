import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "/admin/ajustes", permanent: true },
});

export default function Page() {
  return null;
}
