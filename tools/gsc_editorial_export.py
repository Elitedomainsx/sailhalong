"""Read-only Google Search Console export for editorial planning."""
import csv, json, os
from datetime import date, timedelta, timezone, datetime
from pathlib import Path
from google.oauth2 import service_account
from googleapiclient.discovery import build

SITE_URL=os.environ["GSC_SITE_URL"]
OUTPUT=Path("gsc-editorial-export")
FIELDS=["page","query","clicks","impressions","ctr","position","startDate","endDate"]
PAGE_SIZE=25000

def service():
    info=json.loads(os.environ["GSC_CREDENTIALS_JSON"])
    creds=service_account.Credentials.from_service_account_info(info,scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
    return build("searchconsole","v1",credentials=creds,cache_discovery=False)

def rows(api,start,end,dimensions):
    out=[]; offset=0
    while True:
        body={"startDate":start.isoformat(),"endDate":end.isoformat(),"dimensions":dimensions,"type":"web","rowLimit":PAGE_SIZE,"startRow":offset}
        batch=api.searchanalytics().query(siteUrl=SITE_URL,body=body).execute().get("rows",[])
        for item in batch:
            keys=dict(zip(dimensions,item.get("keys",[])))
            out.append({"page":keys.get("page",""),"query":keys.get("query",""),"clicks":item.get("clicks",0),"impressions":item.get("impressions",0),"ctr":item.get("ctr",0),"position":item.get("position",0),"startDate":start.isoformat(),"endDate":end.isoformat()})
        if len(batch)<PAGE_SIZE: return out
        offset+=PAGE_SIZE
        if offset>=50000: raise RuntimeError("Search Console row cap reached; split the date range")

def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=FIELDS); w.writeheader(); w.writerows(data)

def main():
    if not os.getenv("GSC_CREDENTIALS_JSON"): raise RuntimeError("GSC_CREDENTIALS_JSON is missing")
    api=service(); OUTPUT.mkdir(exist_ok=True)
    end=date.today()-timedelta(days=3)
    manifest={"property":SITE_URL,"generated_at_utc":datetime.now(timezone.utc).isoformat(),"data_end_date":end.isoformat(),"source":"Google Search Console Search Analytics API","note":"Rows can omit anonymized queries.","windows":{}}
    for days in (28,90):
        start=end-timedelta(days=days-1); counts={}
        for label,dims in (("queries",["query"]),("pages",["page"]),("page_queries",["page","query"])):
            data=rows(api,start,end,dims); write(OUTPUT/f"{days}d_{label}.csv",data); counts[label]=len(data)
            if days==28 and label=="page_queries": write(Path("data/gsc_latest.csv"),data)
        manifest["windows"][str(days)]={"start":start.isoformat(),"end":end.isoformat(),"rows":counts}
    (OUTPUT/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(manifest))
if __name__=="__main__": main()
