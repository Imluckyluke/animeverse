#!/usr/bin/env python3
"""Explicit one-time setup for the two public cache repos and private TLS config.

This never changes the visibility or contents of the existing application repo.
No credentials are printed, added to Git, or copied into public assets.
"""
import datetime as dt
import ipaddress
import json
import os
from pathlib import Path
import secrets
import urllib.error
import urllib.request

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from download_cache import REPOSITORIES

PRIVATE = Path.home()/'.local/share/animeverse-download-cache'
SERVER = '109.125.177.141'


def private_write(path, content):
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as file:
        file.write(content)
    path.chmod(0o600)


def github(path, method='GET', payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request('https://api.github.com'+path,data=data,method=method,headers={
        'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=60) as response:
        return json.load(response)


def main():
    owner = github('/user')['login']
    assert owner.lower()=='itisluckyluke-dev', 'Unexpected GitHub account; no repositories created'
    for bucket,full_name in REPOSITORIES.items():
        try:
            repo = github('/repos/'+full_name)
        except urllib.error.HTTPError as error:
            if error.code!=404:
                raise
            repo = github('/user/repos','POST',{
                'name':full_name.split('/')[1],'private':False,'auto_init':True,
                'description':'AnimeVerse '+('popular' if bucket=='hot' else 'temporary')+' managed download cache. Release assets only.',
                'homepage':'https://animeverse-xi.vercel.app','has_issues':False,'has_projects':False,'has_wiki':False})
        assert repo['full_name'].lower()==full_name.lower() and repo['private'] is False and not repo['archived']
        print('PUBLIC_CACHE_REPOSITORY_READY',repo['html_url'],flush=True)
    PRIVATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    PRIVATE.chmod(0o700)
    ca_path = PRIVATE/'ca.crt'
    if not ca_path.exists():
        now = dt.datetime.now(dt.timezone.utc)
        ca_key = rsa.generate_private_key(public_exponent=65537,key_size=3072)
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'AnimeVerse Download Cache Private CA')])
        ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
            .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now-dt.timedelta(minutes=5)).not_valid_after(now+dt.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True,key_encipherment=False,key_cert_sign=True,crl_sign=True,
                content_commitment=False,data_encipherment=False,key_agreement=False,encipher_only=False,decipher_only=False),critical=True)
            .sign(ca_key,hashes.SHA256()))
        server_key = rsa.generate_private_key(public_exponent=65537,key_size=2048)
        server_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,SERVER)])
        server = (x509.CertificateBuilder().subject_name(server_name).issuer_name(ca.subject)
            .public_key(server_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now-dt.timedelta(minutes=5)).not_valid_after(now+dt.timedelta(days=825))
            .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(SERVER))]),critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False)
            .sign(ca_key,hashes.SHA256()))
        private_write(PRIVATE/'ca.key',ca_key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode())
        private_write(ca_path,ca.public_bytes(serialization.Encoding.PEM).decode())
        private_write(PRIVATE/'server.key',server_key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode())
        private_write(PRIVATE/'server.crt',server.public_bytes(serialization.Encoding.PEM).decode())
    config_path = PRIVATE/'frontend.json'
    config = json.loads(config_path.read_text()) if config_path.exists() else {
        'AV_DOWNLOAD_CACHE_ORIGIN':'https://'+SERVER+':8443',
        'AV_DOWNLOAD_CACHE_TOKEN':secrets.token_urlsafe(48),
        'AV_DOWNLOAD_CACHE_CA_PEM':ca_path.read_text()}
    temporary = github('/repos/'+REPOSITORIES['temp'])
    config['AV_DOWNLOAD_CACHE_DISCOVERY_URL'] = 'https://raw.githubusercontent.com/'+REPOSITORIES['temp']+'/'+temporary['default_branch']+'/cache-origin.json'
    config.pop('AV_DOWNLOAD_CACHE_ORIGIN',None)
    config.pop('AV_DOWNLOAD_CACHE_CA_PEM',None)
    private_write(config_path,json.dumps(config))
    def env_quote(value):
        assert '\n' not in value and '\r' not in value
        return '"'+value.replace('\\','\\\\').replace('"','\\"')+'"'
    environment = {
        'GH_TOKEN':os.environ['GH_TOKEN'],'AV_CACHE_API_TOKEN':config['AV_DOWNLOAD_CACHE_TOKEN'],
        'AV_CACHE_PRIVATE':str(PRIVATE),'AV_CACHE_TTL':'86400','AV_CACHE_PORT':'8443',
        'PYTHONPATH':str(Path.home()/'.cache/animeverse-download-cache')}
    private_write(PRIVATE/'service.env','\n'.join(key+'='+env_quote(value) for key,value in environment.items())+'\n')
    print('PRIVATE_CACHE_TLS_AND_ENV_READY',flush=True)


if __name__=='__main__':
    main()
