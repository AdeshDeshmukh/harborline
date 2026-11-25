import { AssetDetail } from "../../../../features/orders/asset-detail";
export default async function AssetPage({params}:{params:Promise<{id:string}>}){
  await params;
  // No live catalog composition: unavailable metadata never becomes a listing.
  return <AssetDetail/>;
}
