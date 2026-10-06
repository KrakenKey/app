import ApiKeyManagement from '../components/ApiKeyManagement';
import GithubOidcTrusts from '../components/GithubOidcTrusts';

export default function ApiKeys() {
  return (
    <>
      <ApiKeyManagement />
      <GithubOidcTrusts />
    </>
  );
}
