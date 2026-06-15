import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin/caja', permanent: true },
});

export default function CashRedirect() {
  return null;
}
