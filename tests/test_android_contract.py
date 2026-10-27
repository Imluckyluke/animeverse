import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
ANDROID=ROOT/'android'
A='{http://schemas.android.com/apk/res/android}'

class NativeAndroidContractTests(unittest.TestCase):
    def setUp(self):self.manifest=ET.parse(ANDROID/'app/src/main/AndroidManifest.xml').getroot()
    def test_resources_are_valid_xml(self):
        for path in ANDROID.glob('app/src/main/res/**/*.xml'):ET.parse(path)
    def test_main_activity_renders_native_compose_not_a_web_page(self):
        source=(ANDROID/'app/src/main/java/app/animeverse/android/MainActivity.kt').read_text()
        self.assertIn('class MainActivity:ComponentActivity()',source)
        self.assertIn('setContent{AnimeVerseApp(',source)
        self.assertNotIn('LauncherActivity',source)
        for file in (ANDROID/'app/src/main/java').rglob('*.kt'):
            self.assertNotRegex(file.read_text(),r'import\s+(?:android\.webkit|com\.google\.androidbrowserhelper|androidx\.browser)')
        gradle=(ANDROID/'app/build.gradle').read_text()
        self.assertIn('androidx.compose',gradle)
        self.assertNotIn('androidbrowserhelper',gradle)
    def test_no_sensitive_permissions_or_cleartext_network(self):
        permissions={node.attrib[A+'name'] for node in self.manifest.findall('uses-permission')}
        self.assertEqual(permissions,{'android.permission.INTERNET','android.permission.ACCESS_NETWORK_STATE'})
        app=self.manifest.find('application')
        self.assertEqual(app.attrib[A+'usesCleartextTraffic'],'false')
        self.assertEqual(app.attrib[A+'allowBackup'],'false')
        self.assertIsNone(app.find('service'))
    def test_native_app_links_are_scoped_to_production(self):
        activity=self.manifest.find('application/activity')
        filters=[f for f in activity.findall('intent-filter') if f.attrib.get(A+'autoVerify')=='true']
        self.assertEqual(len(filters),1)
        self.assertEqual(filters[0].find('data').attrib,{A+'scheme':'https',A+'host':'animeverse-xi.vercel.app'})
        source=(ANDROID/'app/src/main/java/app/animeverse/android/MainActivity.kt').read_text()
        self.assertIn('uri.userInfo!=null',source)
        self.assertIn('uri.port !in listOf(-1,443)',source)
    def test_native_catalog_and_search_do_not_load_site_html(self):
        source=(ANDROID/'app/src/main/java/app/animeverse/android/CatalogRepository.kt').read_text()
        self.assertIn('/api/app/catalog',source)
        self.assertIn('context.assets.open("catalog.json")',source)
        self.assertIn('temporary.renameTo(cache)',source)
        self.assertNotIn('text/html',source)
    def test_local_state_is_native_and_passwords_are_not_plaintext(self):
        source=(ANDROID/'app/src/main/java/app/animeverse/android/DeviceStore.kt').read_text()
        self.assertIn('getSharedPreferences',source)
        self.assertIn('PBEKeySpec',source)
        self.assertIn('120_000',source)
        self.assertIn('MessageDigest.isEqual',source)
        self.assertNotIn('.put("password",',source)
    def test_public_association_matches_package_and_private_key_is_not_bundled(self):
        links=json.loads((ROOT/'public/.well-known/assetlinks.json').read_text())
        self.assertEqual(links[0]['target']['package_name'],'app.animeverse.android')
        self.assertRegex(links[0]['target']['sha256_cert_fingerprints'][0],r'^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$')
        self.assertIn('android',(ROOT/'.vercelignore').read_text().splitlines())
        self.assertEqual([p for p in ANDROID.rglob('*') if p.is_file() and p.suffix in {'.jks','.keystore','.p12'}],[])

if __name__=='__main__':unittest.main()
